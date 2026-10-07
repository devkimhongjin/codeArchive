package com.codearchive.api.config;

import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.codearchive.api.automation.GithubAutomationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "codearchive.github.worker.http-enabled=true",
        "codearchive.github.cloud-tasks.queue-name=private-queue"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityConfigWorkerEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private GithubAutomationService automation;

    @Test
    void privateWorkerExecutionBypassesBrowserCsrfAndReachesTheWorker() throws Exception {
        mockMvc.perform(post("/internal/github/jobs/42")
                        .header("X-CloudTasks-QueueName", "private-queue"))
                .andExpect(status().isNoContent());

        verify(automation).process(42L);
    }
}
