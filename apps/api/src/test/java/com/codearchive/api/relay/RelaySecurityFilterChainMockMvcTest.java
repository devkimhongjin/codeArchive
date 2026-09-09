package com.codearchive.api.relay;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.common.filter.RequestIdFilter;

import jakarta.servlet.http.Cookie;

/** Real security chain and controller; grant lookup and persistence are isolated mocks. */
@WebMvcTest(controllers = RelayCaptureController.class)
@Import(SecurityConfig.class)
@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = {
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
class RelaySecurityFilterChainMockMvcTest {
    private static final String PATH = "/api/v1/relay/captures";
    private static final String ORIGIN = "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";
    private static final String TOKEN = "synthetic-relay-credential";
    private static final RelayGrantPrincipal PRINCIPAL = new RelayGrantPrincipal(
            UUID.randomUUID(), UUID.randomUUID(), "synthetic-device-1234", 26);

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;
    @MockitoBean RelayGrantService grants;
    @MockitoBean RelayCaptureIngestService ingest;

    @Test
    void validRelaySurvivesOrdinaryAuthFilterAndReachesController() throws Exception {
        when(grants.authenticate(TOKEN)).thenReturn(Optional.of(PRINCIPAL));
        when(auth.authenticate(TOKEN)).thenReturn(Optional.empty());
        when(ingest.ingest(eq(PRINCIPAL), any())).thenReturn(
                new RelayCaptureIngestService.Response(List.of()));

        mvc.perform(relay().header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.results").isArray());
        verify(ingest).ingest(eq(PRINCIPAL), any());
    }

    @Test
    void invalidRelayIsRejectedBeforeIngest(CapturedOutput output) throws Exception {
        when(grants.authenticate(TOKEN)).thenReturn(Optional.empty());
        when(grants.authenticationRejectionReason(TOKEN)).thenReturn("TOKEN_NOT_FOUND");
        var result = mvc.perform(relay().header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists(RequestIdFilter.REQUEST_ID_HEADER))
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"))
                .andReturn();
        String requestId = result.getResponse().getHeader(RequestIdFilter.REQUEST_ID_HEADER);
        assertThat(requestId).isNotEqualTo("unknown");
        assertThat(result.getResponse().getContentAsString()).contains("\"requestId\":\"" + requestId + "\"");
        assertThat(output.getOut()).contains("relay_auth_rejected requestId=" + requestId + " reason=TOKEN_NOT_FOUND")
                .doesNotContain(TOKEN);
        verifyNoInteractions(ingest);
    }

    @Test
    void diagnosticFailureDoesNotReplaceAuthenticationRejection(CapturedOutput output) throws Exception {
        when(grants.authenticate(TOKEN)).thenReturn(Optional.empty());
        when(grants.authenticationRejectionReason(TOKEN)).thenThrow(new IllegalStateException("synthetic-private-detail"));
        mvc.perform(relay().header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
        assertThat(output.getOut()).contains("reason=DIAGNOSTIC_UNAVAILABLE")
                .doesNotContain("synthetic-private-detail", TOKEN);
        verifyNoInteractions(ingest);
    }

    @Test
    void missingCredentialIsRejected() throws Exception {
        mvc.perform(relay()).andExpect(status().isUnauthorized());
        verifyNoInteractions(ingest);
    }

    @Test
    void validRelayWithDashboardCookieIsRejectedAsAmbiguous() throws Exception {
        when(grants.authenticate(TOKEN)).thenReturn(Optional.of(PRINCIPAL));
        mvc.perform(relay().header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN)
                        .cookie(new Cookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME,
                                "synthetic-dashboard-cookie")))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(ingest);
    }

    @Test
    void relayCannotAccessOrdinaryApi() throws Exception {
        when(grants.authenticate(TOKEN)).thenReturn(Optional.of(PRINCIPAL));
        mvc.perform(get("/api/v1/me").header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(ingest);
    }

    @Test
    void allowedExtensionPreflightDoesNotNeedCredential() throws Exception {
        mvc.perform(options(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type"))
                .andExpect(status().isOk());
        verifyNoInteractions(ingest);
    }

    @Test
    void unrelatedOriginIsRejectedBeforeIngest() throws Exception {
        mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, "https://untrusted.example")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"records\":[]}")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(status().isForbidden());
        verifyNoInteractions(ingest);
    }

    private MockHttpServletRequestBuilder relay() {
        return post(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content("{\"records\":[]}");
    }
}
