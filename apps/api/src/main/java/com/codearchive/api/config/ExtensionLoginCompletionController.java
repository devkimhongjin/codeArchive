package com.codearchive.api.config;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.RestController;

/** Fixed, inert browser landing point consumed by the extension's tab-return fence. */
@RestController
public class ExtensionLoginCompletionController {
    @GetMapping("/api/extension-login/complete")
    ResponseEntity<String> complete() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
                .contentType(MediaType.TEXT_HTML).body("<!doctype html><title>CodeArchive</title>");
    }
    @PostMapping("/api/extension-login/start")
    ResponseEntity<?> start(@RequestHeader(value = "Origin", required = false) String origin, HttpServletRequest request) {
        if (!SecurityConfig.isExtensionOrigin(origin)) return ResponseEntity.status(403).cacheControl(CacheControl.noStore()).build();
        // This POST is CSRF protected by SecurityConfig. Its exact extension
        // Origin is the proof used later when Chrome opens a top-level OAuth
        // navigation without an Origin header.
        request.getSession(true).setAttribute(SecurityConfig.EXTENSION_OAUTH_INTENT,
                SecurityConfig.ExtensionOAuthIntent.issue());
        request.getSession(true).removeAttribute(SecurityConfig.EXTENSION_OAUTH_COMPLETION);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(java.util.Map.of("authorizationUrl", "/api/oauth2/authorization/github"));
    }
}
