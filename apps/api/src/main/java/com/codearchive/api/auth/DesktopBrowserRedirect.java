package com.codearchive.api.auth;

import jakarta.servlet.http.HttpServletResponse;

/** Preserve the browser-facing proxy origin and its session cookie. */
public final class DesktopBrowserRedirect {
    private DesktopBrowserRedirect() {}
    public static void oauth(HttpServletResponse response) { redirect(response, "/api/oauth2/authorization/github"); }
    public static void confirm(HttpServletResponse response) { redirect(response, "/api/desktop-auth/confirm"); }
    public static void install(HttpServletResponse response) { redirect(response, "/api/desktop-auth/install"); }
    public static void failed(HttpServletResponse response) { redirect(response, "/api/desktop-auth/failed"); }
    private static void redirect(HttpServletResponse response, String path) {
        // sendRedirect is expanded to the upstream origin by ForwardedHeaderFilter.
        // These fixed relative Location values are resolved by the browser itself.
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader("Location", path);
    }
}
