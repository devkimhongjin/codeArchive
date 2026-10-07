package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import jakarta.servlet.http.Cookie;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "codearchive.desktop-login.enabled=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DesktopLoginIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired DesktopLoginService login;
    @Autowired DesktopLoginRepository requests;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.session.SessionRepository sessions;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper json;
    private final String verifier = "v".repeat(43);
    @BeforeEach void setup() {
        requests.deleteAll();
        jdbc.update("MERGE INTO desktop_login_lock KEY(id) VALUES (1)");
        if (users.findByGithubId("918273645").isEmpty()) users.save(AppUser.fromGithub("918273645", "desktop-test", "Desktop Test", null));
    }
    String challenge() throws Exception { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
    String create() throws Exception {
        var result = mvc.perform(post("/api/desktop-auth/requests").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("challenge", challenge()))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store")).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("requestId").asText();
    }
    Cookie bind(String id) throws Exception {
        var result = mvc.perform(get("/api/desktop-auth/authorize").param("requestId", id))
                .andExpect(status().isFound()).andExpect(redirectedUrl("/api/oauth2/authorization/github")).andReturn();
        Cookie cookie = result.getResponse().getCookie("JSESSIONID");
        String sessionId = new String(Base64.getDecoder().decode(cookie.getValue()), StandardCharsets.UTF_8);
        var browserSession = sessions.findById(sessionId);
        var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
        var principal = new GithubOAuth2User(authorities, Map.of("id", "918273645", "login", "desktop-test"), new GithubIdentity("918273645", "desktop-test", "Desktop Test", null));
        var context = org.springframework.security.core.context.SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken(principal, authorities, "github"));
        browserSession.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        sessions.save(browserSession);
        return cookie;
    }
    org.springframework.test.web.servlet.request.RequestPostProcessor user() {
        var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
        return oauth2Login().clientRegistration(org.springframework.security.oauth2.client.registration.ClientRegistration.withRegistrationId("github")
                .clientId("test-client").clientSecret("test-secret")
                .clientAuthenticationMethod(org.springframework.security.oauth2.core.ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(org.springframework.security.oauth2.core.AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("http://localhost:5173/api/login/oauth2/code/github")
                .authorizationUri("https://github.com/login/oauth/authorize").tokenUri("https://github.com/login/oauth/access_token")
                .userInfoUri("https://api.github.com/user").userNameAttributeName("id").clientName("GitHub").build()).oauth2User(new GithubOAuth2User(authorities, Map.of("id", "918273645", "login", "desktop-test"), new GithubIdentity("918273645", "desktop-test", "Desktop Test", null)));
    }
    String exchangeBody(String id, String proof) throws Exception { return json.writeValueAsString(Map.of("requestId", id, "verifier", proof)); }
    @Test void explicitApprovalExchangesOnlyOnceIntoAnIndependentAuthenticatedSession() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isAccepted());
        mvc.perform(get("/api/desktop-auth/confirm").cookie(browser))
                .andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("이 계정으로 PC 앱 로그인")));
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser).with(csrf()))
                .andExpect(status().isOk());
        var nativeResult = mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier)))
                .andExpect(status().isOk()).andReturn();
        var nativeCookie = nativeResult.getResponse().getCookie("JSESSIONID");
        assertThat(nativeCookie).isNotNull(); assertThat(nativeCookie.getValue()).isNotEqualTo(browser.getValue());
        String browserId = new String(Base64.getDecoder().decode(browser.getValue()), StandardCharsets.UTF_8);
        sessions.deleteById(browserId);
        mvc.perform(get("/api/auth/me").cookie(nativeCookie)).andExpect(status().isOk()).andExpect(jsonPath("$.githubId").value("918273645"));
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isGone());
    }
    @Test void wrongProofCannotConsumeAnApprovedRequest() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser).with(csrf())).andExpect(status().isOk());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, "x".repeat(43)))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isOk());
    }
    @Test void approvalRequiresBothBrowserBindingAndCsrf() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser)).andExpect(status().isForbidden());
        mvc.perform(post("/api/desktop-auth/approve").with(user()).with(csrf())).andExpect(status().isGone());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isAccepted());
    }
    @Test void anotherBrowserCannotRebindAnIntent() throws Exception {
        String id = create(); bind(id);
        mvc.perform(get("/api/desktop-auth/authorize").param("requestId", id)).andExpect(status().isConflict());
        mvc.perform(get("/api/desktop-auth/confirm").with(user())).andExpect(status().isGone());
    }
    @Test void expiredRequestsNeverApproveOrExchange() throws Exception {
        String id = create(); var browser = bind(id);
        jdbc.update("UPDATE desktop_login_requests SET expires_at = ?", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(1)));
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser).with(csrf())).andExpect(status().isGone());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isGone());
    }
    @Test void handoffDoesNotBroadenExtensionCorsOrRemoveOrdinaryCsrf() throws Exception {
        mvc.perform(post("/api/desktop-auth/requests").header("Origin", "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("challenge", challenge())))).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").with(user())).andExpect(status().isForbidden());
    }
    @Test void invalidOrUnknownIntentIsRejectedWithoutRedirectingElsewhere() throws Exception {
        mvc.perform(get("/api/desktop-auth/authorize").param("requestId", "https://evil.example/")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody("a".repeat(43), verifier))).andExpect(status().isGone());
        mvc.perform(post("/api/desktop-auth/requests").contentType(MediaType.APPLICATION_JSON).content("{\"challenge\":\"short\"}")).andExpect(status().isBadRequest());
    }
    @Test void canceledBrowserApprovalCannotBecomeANativeSession() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/cancel").cookie(browser).with(csrf())).andExpect(status().isOk());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isGone());
    }
    @Test void pendingRequestsAreBoundedAndExpiredRowsAreCleanedUp() throws Exception {
        for (int i = 0; i < 10; i++) create();
        mvc.perform(post("/api/desktop-auth/requests").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("challenge", challenge())))).andExpect(status().isTooManyRequests());
        jdbc.update("UPDATE desktop_login_requests SET expires_at = ?", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(1)));
        create(); assertThat(requests.count()).isEqualTo(1);
    }
    @Test void browserInstallationChecksTheNativeAccountAndRetainsCsrf() throws Exception {
        var browser = bind(create());
        mvc.perform(get("/api/desktop-auth/install").param("githubId", "918273645").cookie(browser)).andExpect(status().isOk());
        mvc.perform(post("/api/desktop-auth/install").cookie(browser)).andExpect(status().isForbidden());
        mvc.perform(get("/api/desktop-auth/install").param("githubId", "9999").cookie(browser)).andExpect(status().isConflict());
        mvc.perform(get("/api/desktop-auth/install").param("githubId", "https://evil.test")).andExpect(status().isBadRequest());
    }
    @Test void evenAllowedWebOriginsCannotCreateOrExchangeANativeSession() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser).with(csrf())).andExpect(status().isOk());
        mvc.perform(post("/api/desktop-auth/exchange").header("Origin", "http://localhost:5173").contentType(MediaType.APPLICATION_JSON)
                .content(exchangeBody(id, verifier))).andExpect(status().isForbidden());
        mvc.perform(post("/api/desktop-auth/requests").header("Origin", "http://localhost:5173").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("challenge", challenge())))).andExpect(status().isForbidden());
        mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON).content(exchangeBody(id, verifier))).andExpect(status().isOk());
    }
    @Test void concurrentExchangesCanCreateOnlyOneSession() throws Exception {
        String id = create(); var browser = bind(id);
        mvc.perform(post("/api/desktop-auth/approve").cookie(browser).with(csrf())).andExpect(status().isOk());
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Callable<Integer> exchange = () -> mvc.perform(post("/api/desktop-auth/exchange").contentType(MediaType.APPLICATION_JSON)
                    .content(exchangeBody(id, verifier))).andReturn().getResponse().getStatus();
            var results = pool.invokeAll(List.of(exchange, exchange));
            assertThat(List.of(results.get(0).get(), results.get(1).get())).containsExactlyInAnyOrder(200, 410);
        } finally { pool.shutdownNow(); }
    }
}
