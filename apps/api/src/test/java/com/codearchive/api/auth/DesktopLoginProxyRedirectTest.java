package com.codearchive.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.codearchive.api.config.GithubOAuth2FailureHandler;
import com.codearchive.api.config.GithubOAuth2SuccessHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.Filter;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;

/** Real servlet responses behind a proxy; no browser/provider or production database. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "codearchive.desktop-login.enabled=true", "server.address=127.0.0.1",
        "server.forward-headers-strategy=framework",
        "spring.datasource.url=jdbc:h2:mem:desktop-proxy-test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1" })
@ActiveProfiles("test")
@Import(DesktopLoginProxyRedirectTest.ProviderFixture.class)
class DesktopLoginProxyRedirectTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired DesktopLoginRepository requests;
    @Autowired ObjectMapper json;
    @Autowired org.springframework.session.SessionRepository<?> sessions;
    final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    final String verifier = "v".repeat(43);

    @BeforeEach void setup() { requests.deleteAll(); jdbc.update("MERGE INTO desktop_login_lock KEY(id) VALUES (1)"); }
    HttpRequest.Builder request(String path, String cookie) {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("X-Forwarded-Proto", "https").header("X-Forwarded-Host", "backend.example.test")
                .header("X-Forwarded-Port", "443");
        if (cookie != null) builder.header("Cookie", cookie);
        return builder;
    }
    HttpResponse<String> get(String path, String cookie) throws Exception {
        return client.send(request(path, cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<String> post(String path, Map<String, String> body) throws Exception {
        return client.send(request(path, null).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }
    String create() throws Exception {
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        var response = post("/api/desktop-auth/requests", Map.of("challenge", challenge));
        assertThat(response.statusCode()).isEqualTo(200);
        return json.readTree(response.body()).get("requestId").asText();
    }
    String cookie(HttpResponse<?> response) {
        return response.headers().allValues("set-cookie").stream().filter(value -> value.startsWith("JSESSIONID="))
                .map(value -> value.split(";", 2)[0]).findFirst().orElseThrow();
    }
    void redirect(HttpResponse<?> response, String expected) {
        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(response.headers().firstValue("location")).contains(expected);
    }
    @Test void proxyLoginApprovalKeepsBrowserOriginAndCreatesAnIndependentNativeSession() throws Exception {
        String id = create();
        var bound = get("/api/desktop-auth/authorize?requestId=" + id, null);
        assertThat(bound.statusCode()).isEqualTo(200);
        String browserCookie = cookie(bound);
        var authenticated = get("/test/provider/success", browserCookie);
        redirect(authenticated, "/api/desktop-auth/confirm");
        var confirm = get("/api/desktop-auth/confirm", browserCookie);
        assertThat(confirm.statusCode()).isEqualTo(200);
        assertThat(confirm.headers().firstValue("referrer-policy")).contains("same-origin");
        var token = Pattern.compile("name=\"_csrf\" value=\"([^\"]+)\"").matcher(confirm.body());
        assertThat(token.find()).isTrue();
        String csrfCookie = confirm.headers().allValues("set-cookie").stream().filter(value -> value.startsWith("XSRF-TOKEN="))
                .map(value -> value.split(";", 2)[0]).findFirst().orElseThrow();
        var approval = client.send(request("/api/desktop-auth/approve", browserCookie + "; " + csrfCookie)
                .header("Origin", "http://localhost:5173")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("_csrf=" + URLEncoder.encode(token.group(1), StandardCharsets.UTF_8))).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(approval.statusCode()).isEqualTo(200);
        var exchanged = post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier));
        assertThat(exchanged.statusCode()).isEqualTo(200);
        String nativeCookie = cookie(exchanged);
        assertThat(nativeCookie.equals(browserCookie)).isFalse();
        assertThat(get("/api/auth/me", nativeCookie).statusCode()).isEqualTo(200);
        assertThat(get("/api/auth/me", browserCookie).statusCode()).isEqualTo(200);
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier)).statusCode()).isEqualTo(410);
    }
    @Test void proxyInstallationLoginAlsoKeepsTheBrowserOrigin() throws Exception {
        var start = get("/api/desktop-auth/install?githubId=918273647", null);
        redirect(start, "/api/oauth2/authorization/github");
        String browserCookie = cookie(start);
        redirect(get("/test/provider/success", browserCookie), "/api/desktop-auth/install");
        var install = get("/api/desktop-auth/install", browserCookie);
        assertThat(install.statusCode()).isEqualTo(200);
        assertThat(install.headers().firstValue("referrer-policy")).contains("same-origin");
    }
    @Test void webLoginButtonRetainsOriginAndFreshOAuthAutomaticallyCompletesTheHandoff() throws Exception {
        String id = create();
        var landing = get("/api/desktop-auth/authorize?requestId=" + id, null);
        assertThat(landing.statusCode()).isEqualTo(200);
        assertThat(landing.headers().firstValue("content-type").orElse("")).contains("text/html");
        assertThat(landing.headers().firstValue("referrer-policy")).contains("same-origin");
        String browserCookie = cookie(landing);
        var csrf = Pattern.compile("name=\"_csrf\" value=\"([^\"]+)\"").matcher(landing.body());
        assertThat(csrf.find()).isTrue();
        String csrfCookie = landing.headers().allValues("set-cookie").stream().filter(value -> value.startsWith("XSRF-TOKEN="))
                .map(value -> value.split(";", 2)[0]).findFirst().orElseThrow();
        var invalidOrigin = client.send(request("/api/desktop-auth/browser-login", browserCookie + "; " + csrfCookie)
                .header("Origin", "null").header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("_csrf=" + URLEncoder.encode(csrf.group(1), StandardCharsets.UTF_8))).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(invalidOrigin.statusCode()).isEqualTo(403);
        assertThat(invalidOrigin.body()).isEqualTo("Invalid CORS request");
        var start = client.send(request("/api/desktop-auth/browser-login", browserCookie + "; " + csrfCookie)
                .header("Origin", "http://localhost:5173").header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("_csrf=" + URLEncoder.encode(csrf.group(1), StandardCharsets.UTF_8))).build(), HttpResponse.BodyHandlers.ofString());
        redirect(start, "/api/oauth2/authorization/github");
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier)).statusCode()).isEqualTo(202);
        redirect(get("/test/provider/success", browserCookie), "/api/desktop-auth/complete");
        var complete = get("/api/desktop-auth/complete", browserCookie);
        assertThat(complete.statusCode()).isEqualTo(200);
        assertThat(complete.body()).contains("codearchive://auth/complete", "로그인이 완료되었습니다").doesNotContain(verifier, id);
        var nonce = Pattern.compile("<script nonce=\"([^\"]+)\"").matcher(complete.body()); assertThat(nonce.find()).isTrue();
        assertThat(complete.headers().firstValue("content-security-policy").orElse("")).contains("script-src 'nonce-" + nonce.group(1) + "'");
        var exchange = post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier));
        assertThat(exchange.statusCode()).isEqualTo(200);
        assertThat(get("/api/auth/me", cookie(exchange)).statusCode()).isEqualTo(200);
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier)).statusCode()).isEqualTo(410);
    }
    @Test void failedProxyLoginKeepsTheBrowserOriginAndCancelsTheHandoff() throws Exception {
        String id = create();
        var bound = get("/api/desktop-auth/authorize?requestId=" + id, null);
        assertThat(bound.statusCode()).isEqualTo(200);
        redirect(get("/test/provider/failure", cookie(bound)), "/api/desktop-auth/failed");
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier)).statusCode()).isEqualTo(410);
    }
    @Test void directLoginRedirectsToOAuthAndOnlyItsBrowserCodeAndNativeProofCanExchange() throws Exception {
        String state = "s".repeat(43);
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        var started = get("/api/desktop-auth/start?challenge=" + challenge + "&state=" + state, null);
        redirect(started, "/api/oauth2/authorization/github");
        assertThat(started.body()).doesNotContain("<form", "<button");
        String browserCookie = cookie(started);
        redirect(get("/test/provider/success", browserCookie), "/api/desktop-auth/complete");
        var complete = get("/api/desktop-auth/complete", browserCookie);
        assertThat(complete.statusCode()).isEqualTo(200);
        var link = Pattern.compile("href=\"(codearchive://auth/complete[^\"]+)\"").matcher(complete.body());
        assertThat(link.find()).isTrue();
        URI target = URI.create(link.group(1).replace("&amp;", "&"));
        Map<String, String> values = java.util.Arrays.stream(target.getRawQuery().split("&")).map(value -> value.split("=", 2))
                .collect(java.util.stream.Collectors.toMap(pair -> pair[0], pair -> pair[1]));
        assertThat(values.get("state")).isEqualTo(state);
        assertThat(complete.body()).contains("window.location.replace(").doesNotContain(verifier, "<form", "<button");
        String id = values.get("requestId"), code = values.get("code");
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier)).statusCode()).isEqualTo(401);
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier, "code", "x".repeat(43))).statusCode()).isEqualTo(401);
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", "x".repeat(43), "code", code)).statusCode()).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT callback_code_hash FROM desktop_login_requests", String.class)).isNotEqualTo(code).matches("[a-f0-9]{64}");
        var exchanged = post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier, "code", code));
        assertThat(exchanged.statusCode()).isEqualTo(200);
        String nativeCookie = cookie(exchanged);
        assertThat(nativeCookie).isNotEqualTo(browserCookie);
        sessions.deleteById(new String(Base64.getDecoder().decode(browserCookie.substring("JSESSIONID=".length())), StandardCharsets.UTF_8));
        // Only remove the browser session: native authentication remains independently persisted.
        assertThat(get("/api/auth/me", nativeCookie).statusCode()).isEqualTo(200);
        assertThat(post("/api/desktop-auth/exchange", Map.of("requestId", id, "verifier", verifier, "code", code)).statusCode()).isEqualTo(410);
    }
    @Test void directLoginFailureReturnsOnlyItsStateAndCancelsTheRequest() throws Exception {
        String state = "s".repeat(43);
        var started = get("/api/desktop-auth/start?challenge=" + "a".repeat(43) + "&state=" + state, null);
        redirect(started, "/api/oauth2/authorization/github");
        String browserCookie = cookie(started);
        redirect(get("/test/provider/failure", browserCookie), "/api/desktop-auth/failed");
        var failed = get("/api/desktop-auth/failed", browserCookie);
        assertThat(failed.statusCode()).isEqualTo(200);
        assertThat(failed.body()).contains("codearchive://auth/failed?state=" + state).doesNotContain("requestId=", "&code=");
        assertThat(requests.count()).isZero();
        assertThat(get("/api/desktop-auth/start?challenge=" + "a".repeat(43) + "&state=invalid", null).statusCode()).isEqualTo(400);
    }
    @TestConfiguration static class ProviderFixture {
        @Bean FilterRegistrationBean<Filter> testProvider(GithubOAuth2SuccessHandler success, GithubOAuth2FailureHandler failure) {
            FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>((request, response, chain) -> {
                var req = (jakarta.servlet.http.HttpServletRequest) request;
                var res = (jakarta.servlet.http.HttpServletResponse) response;
                if (req.getRequestURI().equals("/test/provider/success")) {
                    var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
                    var principal = new GithubOAuth2User(authorities, Map.of("id", "918273647", "login", "proxy-test"), new GithubIdentity("918273647", "proxy-test", "Proxy Test", null));
                    var auth = new OAuth2AuthenticationToken(principal, authorities, "github");
                    var context = SecurityContextHolder.createEmptyContext(); context.setAuthentication(auth);
                    new HttpSessionSecurityContextRepository().saveContext(context, req, res);
                    success.onAuthenticationSuccess(req, res, auth); return;
                }
                if (req.getRequestURI().equals("/test/provider/failure")) {
                    failure.onAuthenticationFailure(req, res, new BadCredentialsException("test")); return;
                }
                chain.doFilter(request, response);
            });
            registration.setOrder(-110); return registration;
        }
    }
}
