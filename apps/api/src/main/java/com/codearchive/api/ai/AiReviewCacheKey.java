package com.codearchive.api.ai;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * SHA-256 identity of one review input: the same code, language, model and
 * prompt version reuse a stored review instead of calling the model again.
 */
public final class AiReviewCacheKey {
    private static final byte[] DOMAIN = "codearchive-ai-review-v1".getBytes(StandardCharsets.UTF_8);

    private AiReviewCacheKey() {
    }

    public static String of(String languageKey, String source, String provider, String model, String promptVersion) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String field : new String[] {languageKey, source, provider, model, promptVersion}) {
                updateField(digest, (field == null ? "" : field).getBytes(StandardCharsets.UTF_8));
            }
            updateField(digest, DOMAIN);
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    // Length-prefixing keeps ("ab", "c") and ("a", "bc") distinct.
    private static void updateField(MessageDigest digest, byte[] value) {
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(value.length).array());
        digest.update(value);
    }
}
