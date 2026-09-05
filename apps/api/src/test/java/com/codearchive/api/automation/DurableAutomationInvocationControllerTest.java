package com.codearchive.api.automation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.common.filter.RequestIdFilter;

import jakarta.servlet.http.Cookie;
import org.springframework.mock.web.MockHttpServletRequest;

@WebMvcTest(controllers = DurableAutomationInvocationController.class,
        properties = {
                "codearchive.automation.invocation-token=beta-invocation-token-0123456789",
                "codearchive.auth.dashboard-origin=https://dashboard.example"
        })
@Import(SecurityConfig.class)
class DurableAutomationInvocationControllerTest {

    private static final String TOKEN = "beta-invocation-token-0123456789";
    private static final String REQUEST_ID = "invocation-test";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthService authService;

    @MockitoBean
    private DurableAutomationWorker worker;

    @Test
    void validInvocationRunsWorkerOnceAndReturnsOnlyBoundedStatus()
            throws Exception {
        when(worker.runOnce()).thenReturn(new DurableAutomationWorker.Result(
                "SUCCEEDED", UUID.randomUUID(), "SECRET_ERROR"
        ));

        mockMvc.perform(invocationRequest())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.data.solutionId").doesNotExist())
                .andExpect(jsonPath("$.data.errorCode").doesNotExist())
                .andExpect(jsonPath("$.requestId").value(REQUEST_ID));

        verify(worker).runOnce();
    }

    @Test
    void missingOrWrongTokenDoesNotRunWorker() throws Exception {
        mockMvc.perform(post(DurableAutomationInvocationController.PATH))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(DurableAutomationInvocationController.PATH)
                        .header(DurableAutomationInvocationController.INVOCATION_TOKEN_HEADER,
                                "wrong-token"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(worker);
    }

    @Test
    void malformedOrDuplicateTokenDoesNotRunWorker() throws Exception {
        mockMvc.perform(post(DurableAutomationInvocationController.PATH)
                        .header(
                                DurableAutomationInvocationController.INVOCATION_TOKEN_HEADER,
                                "x".repeat(257)
                        ))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(DurableAutomationInvocationController.PATH)
                        .header(
                                DurableAutomationInvocationController.INVOCATION_TOKEN_HEADER,
                                TOKEN, TOKEN
                        ))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(worker);
    }

    @Test
    void requestBodyIsRejectedBeforeWorker() throws Exception {
        mockMvc.perform(invocationRequest().content("source-code"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(worker);
    }

    @Test
    void sessionCookieCannotAuthorizeInvocation() throws Exception {
        mockMvc.perform(invocationRequest()
                        .cookie(new Cookie(
                                "__Host-codearchive_session", "dashboard-token"
                        )))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(worker);
    }

    @Test
    void dashboardBearerCannotAuthorizeOrReachAuthService() throws Exception {
        mockMvc.perform(invocationRequest()
                        .header("Authorization", "Bearer dashboard-token"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(authService);
        verifyNoInteractions(worker);
    }

    @Test
    void normalProtectedRouteRemainsProtected() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void missingConfigurationFailsClosedWithoutRunningWorker() {
        DurableAutomationWorker directWorker = org.mockito.Mockito.mock(
                DurableAutomationWorker.class
        );
        DurableAutomationInvocationController controller =
                new DurableAutomationInvocationController(directWorker, " ");
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
                DurableAutomationInvocationController.PATH);
        request.addHeader(
                DurableAutomationInvocationController.INVOCATION_TOKEN_HEADER,
                TOKEN
        );

        CodeArchiveException failure = assertThrows(
                CodeArchiveException.class,
                () -> controller.invoke(request)
        );

        assertEquals(
                ErrorCode.AUTOMATION_INVOCATION_UNAVAILABLE,
                failure.getErrorCode()
        );
        verifyNoInteractions(directWorker);
    }

    private MockHttpServletRequestBuilder invocationRequest() {
        return post(DurableAutomationInvocationController.PATH)
                .header(
                        DurableAutomationInvocationController.INVOCATION_TOKEN_HEADER,
                        TOKEN
                )
                .header(RequestIdFilter.REQUEST_ID_HEADER, REQUEST_ID);
    }
}
