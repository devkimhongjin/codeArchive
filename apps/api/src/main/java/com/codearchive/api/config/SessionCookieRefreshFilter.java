package com.codearchive.api.config;

import com.codearchive.api.auth.GithubAuthentication;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.time.Duration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Spring Session writes its cookie only when a session is created or its id changes, so the
 * browser drops a login when that cookie's Max-Age runs out even though every use slides the
 * server-side deadline. Re-issue the cookie for a signed-in session, at most once a day: writing
 * it on every response would let a late answer from an old session overwrite a newer login.
 */
public class SessionCookieRefreshFilter extends OncePerRequestFilter {

    public static final String REFRESHED_AT = SessionCookieRefreshFilter.class.getName() + ".refreshedAt";
    private static final long REFRESH_INTERVAL_MS = Duration.ofDays(1).toMillis();

    private final CookieSerializer cookieSerializer;

    public SessionCookieRefreshFilter(CookieSerializer cookieSerializer) {
        this.cookieSerializer = cookieSerializer;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null && GithubAuthentication.identity(SecurityContextHolder.getContext().getAuthentication()).isPresent()) {
            long now = System.currentTimeMillis();
            if (!(session.getAttribute(REFRESHED_AT) instanceof Long refreshedAt) || now - refreshedAt >= REFRESH_INTERVAL_MS) {
                session.setAttribute(REFRESHED_AT, now);
                cookieSerializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, session.getId()));
            }
        }
        filterChain.doFilter(request, response);
    }
}
