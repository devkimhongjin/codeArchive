package com.codearchive.api.automation;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Only enabled on a private worker service. Cloud Run IAM/OIDC is the primary
 * boundary; the queue header is an additional check for task execution.
 */
@RestController
@RequestMapping("/internal/github")
@ConditionalOnProperty(name = "codearchive.github.worker.http-enabled", havingValue = "true")
public class GithubWorkerController {

    private static final String QUEUE_HEADER = "X-CloudTasks-QueueName";

    private final GithubAutomationService automation;
    private final GithubAutomationProperties properties;

    public GithubWorkerController(GithubAutomationService automation, GithubAutomationProperties properties) {
        this.automation = automation;
        this.properties = properties;
    }

    @PostMapping("/jobs/{jobId}")
    public ResponseEntity<Void> execute(@PathVariable Long jobId,
            @RequestHeader(value = QUEUE_HEADER, required = false) String queueName) {
        if (!properties.getCloudTasks().getQueueName().equals(queueName)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        GithubAutomationService.ProcessResult result = automation.process(jobId);
        if (result == GithubAutomationService.ProcessResult.RETRYABLE) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/recovery")
    public ResponseEntity<Void> recovery() {
        automation.recoverAndDispatch();
        return ResponseEntity.noContent().build();
    }
}
