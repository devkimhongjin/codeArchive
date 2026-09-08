package com.codearchive.api.auth.session;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.UUID;

/**
 * Non-authoritative response metadata for comparing one authenticated session
 * across Dashboard requests. The session UUID itself never crosses the API
 * boundary.
 */
public final class SessionBindingFingerprint {

    public static final String VERSION_PREFIX = "sb1_";
    private static final String DOMAIN = "codearchive:session-binding:sb1:";

    private SessionBindingFingerprint() {}

    public static String of(UUID sessionId) {
        if (sessionId == null) return null;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] value = digest.digest((DOMAIN + sessionId).getBytes(StandardCharsets.UTF_8));
            return VERSION_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(value);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is required", impossible);
        }
    }
}
