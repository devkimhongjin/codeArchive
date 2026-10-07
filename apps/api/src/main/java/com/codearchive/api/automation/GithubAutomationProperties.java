package com.codearchive.api.automation;

import jakarta.validation.constraints.AssertTrue;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "codearchive.github")
public class GithubAutomationProperties {

    private DispatchMode dispatchMode = DispatchMode.POLLING;
    private Worker worker = new Worker();
    private CloudTasks cloudTasks = new CloudTasks();

    public DispatchMode getDispatchMode() { return dispatchMode; }
    public void setDispatchMode(DispatchMode dispatchMode) { this.dispatchMode = dispatchMode; }
    public Worker getWorker() { return worker; }
    public void setWorker(Worker worker) { this.worker = worker; }
    public CloudTasks getCloudTasks() { return cloudTasks; }
    public void setCloudTasks(CloudTasks cloudTasks) { this.cloudTasks = cloudTasks; }

    @AssertTrue(message = "Cloud Tasks mode requires project-id, location, queue-name, worker-url, OIDC service account, and OIDC audience")
    public boolean isCloudTasksConfigurationValid() {
        return dispatchMode != DispatchMode.CLOUD_TASKS || cloudTasks.isComplete();
    }

    public enum DispatchMode { POLLING, CLOUD_TASKS }

    public static class Worker {
        private boolean httpEnabled;
        public boolean isHttpEnabled() { return httpEnabled; }
        public void setHttpEnabled(boolean httpEnabled) { this.httpEnabled = httpEnabled; }
    }

    public static class CloudTasks {
        private String projectId;
        private String location;
        private String queueName;
        private String workerUrl;
        private String oidcServiceAccount;
        private String oidcAudience;

        public String getProjectId() { return projectId; }
        public void setProjectId(String projectId) { this.projectId = projectId; }
        public String getLocation() { return location; }
        public void setLocation(String location) { this.location = location; }
        public String getQueueName() { return queueName; }
        public void setQueueName(String queueName) { this.queueName = queueName; }
        public String getWorkerUrl() { return workerUrl; }
        public void setWorkerUrl(String workerUrl) { this.workerUrl = workerUrl; }
        public String getOidcServiceAccount() { return oidcServiceAccount; }
        public void setOidcServiceAccount(String oidcServiceAccount) { this.oidcServiceAccount = oidcServiceAccount; }
        public String getOidcAudience() { return oidcAudience; }
        public void setOidcAudience(String oidcAudience) { this.oidcAudience = oidcAudience; }

        private boolean isComplete() {
            return present(projectId) && present(location) && present(queueName) && present(workerUrl)
                    && present(oidcServiceAccount) && present(oidcAudience);
        }

        private static boolean present(String value) { return value != null && !value.isBlank(); }
    }
}
