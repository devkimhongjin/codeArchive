package com.codearchive.api.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityConfigDefaultWorkerEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void workerRouteIsStillCsrfProtectedWhenItsControllerIsDisabled() throws Exception {
        mockMvc.perform(post("/internal/github/jobs/42")
                        .header("X-CloudTasks-QueueName", "private-queue"))
                .andExpect(status().isForbidden());
    }
}
