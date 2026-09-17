package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

class GithubWorkerControllerTest {

    @Test
    void requiresTheExpectedQueueHeaderAndRequestsTaskRetryOnlyForRetryableWork() {
        GithubAutomationService automation = mock(GithubAutomationService.class);
        GithubAutomationProperties properties = CloudTasksGithubJobDispatcherTest.configuredProperties();
        GithubWorkerController controller = new GithubWorkerController(automation, properties);

        assertThat(controller.execute(42L, "wrong").getStatusCode().value()).isEqualTo(403);
        when(automation.process(42L)).thenReturn(GithubAutomationService.ProcessResult.RETRYABLE);
        assertThat(controller.execute(42L, "github-commits").getStatusCode().value()).isEqualTo(503);
        verify(automation).process(42L);
    }
}
