package com.codearchive.api.auth;

import com.codearchive.api.config.GithubOAuth2SuccessHandler;
import jakarta.servlet.Filter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;

/** Opt-in local browser/native smoke: synthetic GitHub identity, never a provider login. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "codearchive.desktop-login.enabled=true", "server.address=127.0.0.1",
        "spring.datasource.url=jdbc:h2:mem:desktop-browser-smoke;MODE=PostgreSQL;DB_CLOSE_DELAY=-1" })
@ActiveProfiles("test")
@Import(DesktopBrowserSmokeTest.Fixture.class)
@EnabledIfEnvironmentVariable(named = "CODEARCHIVE_DESKTOP_BROWSER_SMOKE", matches = "true")
class DesktopBrowserSmokeTest {
    static final AtomicBoolean done = new AtomicBoolean();
    static final AtomicReference<String> browserPath = new AtomicReference<>();
    static final AtomicReference<String> callbackUrl = new AtomicReference<>();
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Test void actualBrowserApprovalAndIndependentNativeCookie() throws Exception {
        jdbc.update("MERGE INTO desktop_login_lock KEY(id) VALUES (1)");
        Path ready = Path.of(System.getenv("CODEARCHIVE_DESKTOP_BROWSER_READY"));
        Files.createDirectories(ready.getParent());
        Files.writeString(ready, "http://127.0.0.1:" + port);
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(180).toNanos();
        while (!done.get() && System.nanoTime() < deadline) Thread.sleep(250);
        org.junit.jupiter.api.Assertions.assertTrue(done.get(), "Browser/native smoke did not complete");
    }
    @TestConfiguration
    static class Fixture {
        @Bean FilterRegistrationBean<Filter> syntheticProvider(GithubOAuth2SuccessHandler success) {
            FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>((request, response, chain) -> {
                var req = (jakarta.servlet.http.HttpServletRequest) request;
                var res = (jakarta.servlet.http.HttpServletResponse) response;
                String path = req.getRequestURI();
                if (path.equals("/fixture/browser-url") && req.getMethod().equals("POST")) {
                    String target = req.getReader().readLine();
                    if (target == null || !target.matches("/api/desktop-auth/start\\?challenge=[A-Za-z0-9_-]{43}&state=[A-Za-z0-9_-]{43}")) { res.setStatus(400); return; }
                    browserPath.set(target); res.setStatus(204); return;
                }
                if (path.equals("/fixture/login")) {
                    if (browserPath.get() == null) { res.setStatus(503); return; }
                    res.sendRedirect(browserPath.get()); return;
                }
                if (path.equals("/fixture/complete") && req.getMethod().equals("POST")) { done.set(true); res.setStatus(204); return; }
                if (path.equals("/fixture/callback")) {
                    if (callbackUrl.get() == null) { res.setStatus(202); return; }
                    res.setHeader("Cache-Control", "no-store"); res.getWriter().write(callbackUrl.get()); return;
                }
                if (path.equals("/api/oauth2/authorization/github")) {
                    // This test-only provider stands in for the successful OAuth callback.
                    var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
                    var principal = new GithubOAuth2User(authorities, Map.of("id", "918273646", "login", "browser-smoke"), new GithubIdentity("918273646", "browser-smoke", "Browser Smoke", null));
                    var auth = new OAuth2AuthenticationToken(principal, authorities, "github");
                    var context = SecurityContextHolder.createEmptyContext(); context.setAuthentication(auth);
                    new HttpSessionSecurityContextRepository().saveContext(context, req, res);
                    success.onAuthenticationSuccess(req, res, auth);
                    if (req.getSession().getAttribute(DesktopLoginService.COMPLETED_KEY) instanceof DesktopLoginService.CallbackResult result)
                        callbackUrl.set("codearchive://auth/complete?requestId=" + result.requestId() + "&state=" + result.state() + "&code=" + result.code());
                    return;
                }
                chain.doFilter(request, response);
            });
            registration.setOrder(-110); return registration;
        }
    }
}
