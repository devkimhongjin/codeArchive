package com.codearchive.api.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.HtmlUtils;

@RestController
@RequestMapping("/api/desktop-auth")
public class DesktopLoginController {
    private final DesktopLoginService login;
    private final com.codearchive.api.integration.github.GithubInstallationController installations;
    public DesktopLoginController(DesktopLoginService login, com.codearchive.api.integration.github.GithubInstallationController installations) {
        this.login = login; this.installations = installations;
    }
    public record StartInput(String challenge) {}
    public record ExchangeInput(String requestId, String verifier) {}
    @PostMapping("/requests")
    public DesktopLoginService.Started create(@RequestBody StartInput input, HttpServletRequest request, HttpServletResponse response) {
        protect(response); nativeRequest(request); return login.create(input.challenge(), request.getRemoteAddr());
    }
    @GetMapping("/authorize")
    public void authorize(@RequestParam String requestId, HttpServletRequest request, HttpServletResponse response) throws IOException {
        protect(response);
        String id = login.bind(requestId);
        request.getSession().setAttribute(DesktopLoginService.SESSION_KEY, id);
        response.sendRedirect("/api/oauth2/authorization/github");
    }
    @GetMapping(value = "/confirm", produces = MediaType.TEXT_HTML_VALUE)
    public String confirm(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        protect(response); login.check(binding(request));
        var identity = GithubAuthentication.identity(authentication).orElseThrow(() -> new DesktopLoginService.Failure(HttpStatus.UNAUTHORIZED));
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return page("PC 앱 로그인 확인", "<p>이 PC에서 직접 로그인 버튼을 눌렀을 때만 승인하세요.</p><p>로그인 계정: <strong>@"
                + HtmlUtils.htmlEscape(identity.githubLogin()) + "</strong></p><form method=\"post\" action=\"/api/desktop-auth/approve\">"
                + "<input type=\"hidden\" name=\"" + HtmlUtils.htmlEscape(token.getParameterName()) + "\" value=\""
                + HtmlUtils.htmlEscape(token.getToken()) + "\"><button type=\"submit\">이 계정으로 PC 앱 로그인</button></form>"
                + csrfForm(request, "/api/desktop-auth/cancel", "로그인 취소")
                + "<p>요청하지 않은 로그인이라면 이 창을 닫으세요. 요청은 5분 후 만료됩니다.</p>");
    }
    @PostMapping(value = "/approve", produces = MediaType.TEXT_HTML_VALUE)
    public String approve(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        protect(response);
        String githubId = GithubAuthentication.githubId(authentication).orElseThrow(() -> new DesktopLoginService.Failure(HttpStatus.UNAUTHORIZED));
        login.approve(binding(request), githubId);
        request.getSession().removeAttribute(DesktopLoginService.SESSION_KEY);
        return page("로그인을 승인했습니다", "<p>PC 앱으로 돌아가세요. 이 창은 닫아도 됩니다.</p>");
    }
    @PostMapping(value = "/cancel", produces = MediaType.TEXT_HTML_VALUE)
    public String cancel(HttpServletRequest request, HttpServletResponse response) {
        protect(response); login.cancel(binding(request));
        request.getSession().removeAttribute(DesktopLoginService.SESSION_KEY);
        return page("로그인을 취소했습니다", "<p>이 창을 닫아도 됩니다. PC 앱에서 다시 로그인할 수 있습니다.</p>");
    }
    @GetMapping(value = "/failed", produces = MediaType.TEXT_HTML_VALUE)
    public String failed(HttpServletResponse response) {
        protect(response); return page("로그인하지 못했습니다", "<p>PC 앱에서 다시 로그인해 주세요.</p>");
    }
    @GetMapping(value = "/install", produces = MediaType.TEXT_HTML_VALUE)
    public String install(@RequestParam(required = false) String githubId, HttpServletRequest request, HttpServletResponse response, Authentication authentication) throws IOException {
        protect(response); login.available();
        if (githubId != null) {
            if (!githubId.matches("[0-9]{1,64}")) throw new DesktopLoginService.Failure(HttpStatus.BAD_REQUEST);
            request.getSession().setAttribute(DesktopLoginService.INSTALL_KEY, new DesktopLoginService.InstallIntent(githubId, System.currentTimeMillis() + 300000));
        }
        String expected = installAccount(request);
        var identity = GithubAuthentication.githubId(authentication);
        if (identity.isEmpty()) { response.sendRedirect("/api/oauth2/authorization/github"); return ""; }
        if (!expected.equals(identity.get())) {
            response.setStatus(409);
            return page("GitHub 계정이 다릅니다", "<p>웹브라우저와 PC 앱에서 같은 GitHub 계정으로 로그인한 뒤 다시 연결해 주세요.</p>");
        }
        return page("GitHub App 연결", "<p>PC 앱과 같은 계정으로 GitHub App 설치를 진행합니다.</p>"
                + csrfForm(request, "/api/desktop-auth/install", "GitHub App 설치 계속")
                + "<p>설치를 마친 뒤 PC 앱에서 GitHub 연결 버튼을 다시 눌러 주세요.</p>");
    }
    @PostMapping(value = "/install", produces = MediaType.TEXT_HTML_VALUE)
    public String installApprove(HttpServletRequest request, HttpServletResponse response, Authentication authentication) throws IOException {
        protect(response); login.available(); String expected = installAccount(request);
        var result = installations.start(authentication, expected, request.getSession());
        if (!result.getStatusCode().is2xxSuccessful() || !(result.getBody() instanceof com.codearchive.api.integration.github.GithubInstallationController.StartResponse started)) {
            response.setStatus(result.getStatusCode().value());
            return page("GitHub 연결을 진행하지 못했습니다", "<p>계정과 서버 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>");
        }
        request.getSession().removeAttribute(DesktopLoginService.INSTALL_KEY);
        if ("INSTALL_REQUIRED".equals(started.status())) { response.sendRedirect(started.installUrl()); return ""; }
        return page("GitHub App이 연결되어 있습니다", "<p>PC 앱에서 GitHub 연결 버튼을 다시 눌러 저장소를 선택하세요.</p>");
    }
    @PostMapping("/exchange")
    public ResponseEntity<?> exchange(@RequestBody ExchangeInput input, HttpServletRequest request, HttpServletResponse response) {
        protect(response);
        nativeRequest(request);
        AppUser user = login.exchange(input.requestId(), input.verifier());
        if (user == null) return ResponseEntity.accepted().body(Map.of("pending", true));
        // Create an independent native session; browser cookies are never copied.
        if (request.getSession(false) != null) request.getSession(false).invalidate();
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("id", user.getGithubId()); attributes.put("login", user.getGithubLogin());
        if (user.getGithubName() != null) attributes.put("name", user.getGithubName());
        if (user.getGithubEmail() != null) attributes.put("email", user.getGithubEmail());
        if (user.getGithubAvatarUrl() != null) attributes.put("avatar_url", user.getGithubAvatarUrl());
        var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
        var principal = new GithubOAuth2User(authorities, attributes, new GithubIdentity(user.getGithubId(), user.getGithubLogin(), user.getGithubName(), user.getGithubEmail(), user.getGithubAvatarUrl()));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new OAuth2AuthenticationToken(principal, authorities, "github"));
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context, request, response);
        return ResponseEntity.ok(Map.of("ok", true));
    }
    @ExceptionHandler(DesktopLoginService.Failure.class)
    ResponseEntity<?> failure(DesktopLoginService.Failure failure, HttpServletResponse response) {
        protect(response);
        return ResponseEntity.status(failure.status).body(Map.of("message", "PC app login request is unavailable"));
    }
    private static String binding(HttpServletRequest request) {
        Object value = request.getSession(false) == null ? null : request.getSession(false).getAttribute(DesktopLoginService.SESSION_KEY);
        if (!(value instanceof String id)) throw new DesktopLoginService.Failure(HttpStatus.GONE);
        return id;
    }
    private static void nativeRequest(HttpServletRequest request) {
        // Main-process native requests have no Origin. Browser approval is a separate CSRF-protected route.
        if (request.getHeader("Origin") != null) throw new DesktopLoginService.Failure(HttpStatus.FORBIDDEN);
    }
    private static String installAccount(HttpServletRequest request) {
        Object value = request.getSession(false) == null ? null : request.getSession(false).getAttribute(DesktopLoginService.INSTALL_KEY);
        if (!(value instanceof DesktopLoginService.InstallIntent intent) || !intent.githubId().matches("[0-9]{1,64}")
                || intent.expiresAt() <= System.currentTimeMillis()) throw new DesktopLoginService.Failure(HttpStatus.GONE);
        return intent.githubId();
    }
    private static String csrfForm(HttpServletRequest request, String path, String label) {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return "<form method=\"post\" action=\"" + path + "\"><input type=\"hidden\" name=\"" + HtmlUtils.htmlEscape(token.getParameterName())
                + "\" value=\"" + HtmlUtils.htmlEscape(token.getToken()) + "\"><button type=\"submit\">" + label + "</button></form>";
    }
    private static void protect(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    }
    private static String page(String title, String content) {
        return "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>CodeArchive</title>"
                + "<style>body{font:16px/1.6 system-ui;background:#f5f6fb;color:#202c48;margin:0}main{max-width:520px;margin:12vh auto;padding:32px;background:white;border-radius:16px}button{padding:12px 18px;background:#3457ce;color:white;border:0;border-radius:8px;cursor:pointer}</style>"
                + "<body><main><h1>" + title + "</h1>" + content + "</main></body></html>";
    }
}
