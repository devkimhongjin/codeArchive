package com.codearchive.api.automation;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Kept solely for the existing Render deployment path. */
@Component
@ConditionalOnProperty(name = "codearchive.github.dispatch-mode", havingValue = "polling", matchIfMissing = true)
public class GithubPollingScheduler {

    private final GithubAutomationService automation;

    public GithubPollingScheduler(GithubAutomationService automation) {
        this.automation = automation;
    }

    @Scheduled(fixedDelayString = "${codearchive.github.worker-delay-ms:30000}")
    public void poll() {
        automation.poll();
    }
}
