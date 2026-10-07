package com.codearchive.api.analysis;

import com.codearchive.api.solution.LanguageNormalizer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;

/** Deterministic identity for a source and a specific static-analysis configuration. */
public final class AnalysisCacheKey {
    private static final byte[] DOMAIN = "codearchive-static-analysis-v1".getBytes(StandardCharsets.UTF_8);

    private AnalysisCacheKey() {
    }

    public static Optional<String> forSource(String language, String source,
                                             String analyzerVersion, String configVersion) {
        String key = LanguageNormalizer.canonicalKey(language);
        if (!key.equals("java") && !key.equals("javascript") && !key.equals("typescript")
                && !key.equals("python")) {
            return Optional.empty();
        }
        if (source == null || analyzerVersion == null || analyzerVersion.isBlank()
                || configVersion == null || configVersion.isBlank()) {
            return Optional.empty();
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateField(digest, DOMAIN);
            updateField(digest, key.getBytes(StandardCharsets.UTF_8));
            updateField(digest, source.getBytes(StandardCharsets.UTF_8));
            updateField(digest, analyzerVersion.getBytes(StandardCharsets.UTF_8));
            updateField(digest, configVersion.getBytes(StandardCharsets.UTF_8));
            return Optional.of(HexFormat.of().formatHex(digest.digest()));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static void updateField(MessageDigest digest, byte[] value) {
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(value.length).array());
        digest.update(value);
    }
}
