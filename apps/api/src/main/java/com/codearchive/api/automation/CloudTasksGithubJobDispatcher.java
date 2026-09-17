package com.codearchive.api.automation;

import com.google.api.gax.rpc.AlreadyExistsException;
import com.google.cloud.tasks.v2.CloudTasksClient;
import com.google.cloud.tasks.v2.CreateTaskRequest;
import com.google.cloud.tasks.v2.HttpMethod;
import com.google.cloud.tasks.v2.HttpRequest;
import com.google.cloud.tasks.v2.OidcToken;
import com.google.cloud.tasks.v2.QueueName;
import com.google.cloud.tasks.v2.Task;
import com.google.protobuf.ByteString;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(name = "codearchive.github.dispatch-mode", havingValue = "cloud-tasks")
class CloudTasksGithubJobDispatcherConfiguration {

    @Bean(destroyMethod = "close")
    CloudTasksClient cloudTasksClient() throws IOException {
        return CloudTasksClient.create();
    }

    @Bean
    GithubJobDispatcher cloudTasksGithubJobDispatcher(CloudTasksClient client, GithubAutomationProperties properties) {
        return new CloudTasksGithubJobDispatcher(client, properties);
    }
}

final class CloudTasksGithubJobDispatcher implements GithubJobDispatcher {

    private final CloudTasksClient client;
    private final GithubAutomationProperties properties;

    CloudTasksGithubJobDispatcher(CloudTasksClient client, GithubAutomationProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    @Override
    public void dispatch(Long jobId) {
        if (jobId == null || jobId < 1) {
            throw new IllegalArgumentException("A durable GitHub job id is required");
        }
        GithubAutomationProperties.CloudTasks cloudTasks = properties.getCloudTasks();
        String queue = QueueName.of(cloudTasks.getProjectId(), cloudTasks.getLocation(), cloudTasks.getQueueName())
                .toString();
        String taskName = queue + "/tasks/github-job-" + jobId;
        // The task contains only the opaque durable job id. Source, GitHub material,
        // settings, and identities remain in the database.
        String body = "{\"jobId\":" + jobId + "}";
        Task task = Task.newBuilder()
                .setName(taskName)
                .setHttpRequest(HttpRequest.newBuilder()
                        .setHttpMethod(HttpMethod.POST)
                        .setUrl(executeUrl(cloudTasks.getWorkerUrl(), jobId))
                        .setOidcToken(OidcToken.newBuilder()
                                .setServiceAccountEmail(cloudTasks.getOidcServiceAccount())
                                .setAudience(cloudTasks.getOidcAudience()))
                        .putHeaders("Content-Type", "application/json")
                        .setBody(ByteString.copyFrom(body, StandardCharsets.UTF_8)))
                .build();
        try {
            client.createTask(CreateTaskRequest.newBuilder().setParent(queue).setTask(task).build());
        } catch (AlreadyExistsException ignored) {
            // Deterministic task names make recovery idempotent while a task is outstanding.
        }
    }

    private static String executeUrl(String workerUrl, Long jobId) {
        String base = workerUrl.endsWith("/") ? workerUrl.substring(0, workerUrl.length() - 1) : workerUrl;
        return base + "/internal/github/jobs/" + jobId;
    }
}
