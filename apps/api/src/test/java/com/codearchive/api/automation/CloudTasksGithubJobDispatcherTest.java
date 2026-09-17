package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.google.cloud.tasks.v2.CloudTasksClient;
import com.google.cloud.tasks.v2.CreateTaskRequest;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CloudTasksGithubJobDispatcherTest {

    @Test
    void createsDeterministicTaskWithOnlyTheJobIdInItsPayload() {
        CloudTasksClient client = mock(CloudTasksClient.class);
        GithubAutomationProperties properties = configuredProperties();

        new CloudTasksGithubJobDispatcher(client, properties).dispatch(42L);

        ArgumentCaptor<CreateTaskRequest> request = ArgumentCaptor.forClass(CreateTaskRequest.class);
        verify(client).createTask(request.capture());
        assertThat(request.getValue().getTask().getName()).endsWith("/tasks/github-job-42");
        assertThat(request.getValue().getTask().getHttpRequest().getUrl())
                .isEqualTo("https://worker.example.test/internal/github/jobs/42");
        assertThat(request.getValue().getTask().getHttpRequest().getBody().toStringUtf8())
                .isEqualTo("{\"jobId\":42}");
        assertThat(request.getValue().getTask().getHttpRequest().getOidcToken().getAudience())
                .isEqualTo("https://worker.example.test");
    }

    static GithubAutomationProperties configuredProperties() {
        GithubAutomationProperties properties = new GithubAutomationProperties();
        properties.setDispatchMode(GithubAutomationProperties.DispatchMode.CLOUD_TASKS);
        GithubAutomationProperties.CloudTasks cloudTasks = properties.getCloudTasks();
        cloudTasks.setProjectId("project");
        cloudTasks.setLocation("asia-northeast3");
        cloudTasks.setQueueName("github-commits");
        cloudTasks.setWorkerUrl("https://worker.example.test/");
        cloudTasks.setOidcServiceAccount("tasks@example.iam.gserviceaccount.com");
        cloudTasks.setOidcAudience("https://worker.example.test");
        return properties;
    }
}
