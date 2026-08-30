package com.codearchive.api.auth.beta;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.MeController;
import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.auth.security.SecureTokenCodec;

@WebMvcTest(controllers = {BetaAccessController.class, MeController.class}, properties = {
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com",
        "codearchive.beta-access.password=synthetic-test-password-only"
})
@Import(SecurityConfig.class)
class BetaAccessControllerTest {
    private static final String ORIGIN = "https://codearchive-dashboard-beta.onrender.com";
    private static final String PASSWORD = "synthetic-test-password-only";
    private static final String PATH = "/api/v1/beta/access";
    @Autowired private MockMvc mvc;
    @MockitoBean private AuthService auth;

    @Test
    void correctPasswordReturnsOnlyAcceptanceWithoutCookieOrDatabaseAccess() throws Exception {
        String result = mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.accepted").value(true))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE))
                .andReturn().getResponse().getContentAsString();
        assertThat(result).doesNotContain(PASSWORD, new SecureTokenCodec().hash(PASSWORD));
        verifyNoInteractions(auth);
    }

    @Test
    void wrongPasswordDoesNotEchoInput() throws Exception {
        String result = mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"wrong-secret\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("BETA_ACCESS_REQUIRED"))
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE))
                .andReturn().getResponse().getContentAsString();
        assertThat(result).doesNotContain("wrong-secret", PASSWORD);
        verifyNoInteractions(auth);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"password\":null}", "{\"password\":\"\"}", "{\"password\":\"  \"}"})
    void invalidBodyIsRejected(String body) throws Exception {
        mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void oversizedPasswordIsRejectedWithoutEcho() throws Exception {
        String secret = "sensitive".repeat(20);
        String result = mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"" + secret + "\"}"))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(result).doesNotContain(secret);
    }

    @Test
    void missingOriginIsRejected() throws Exception {
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void unrelatedOriginIsRejectedAndExactPreflightWorks() throws Exception {
        mvc.perform(post(PATH).header(HttpHeaders.ORIGIN, "https://other.example")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(options(PATH).header(HttpHeaders.ORIGIN, ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "short", "        "})
    void missingOrWeakConfigurationKeepsEntryClosed(String configured) {
        var controller = new BetaAccessController(configured, ORIGIN);
        var response = controller.check(new BetaAccessController.PasswordRequest(PASSWORD), ORIGIN, new MockHttpServletRequest());
        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getBody().toString()).contains("BETA_ACCESS_UNAVAILABLE").doesNotContain(PASSWORD);
    }

    @Test
    void requestStringRedactsPasswordAndEntryIsNotAccountAuthentication() throws Exception {
        assertThat(new BetaAccessController.PasswordRequest(PASSWORD).toString()).doesNotContain(PASSWORD);
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
    }
}
