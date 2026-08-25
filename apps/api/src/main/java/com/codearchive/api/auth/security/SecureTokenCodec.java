package com.codearchive.api.auth.security;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

import org.springframework.stereotype.Component;

@Component
public class SecureTokenCodec {

    private static final int TOKEN_BYTES = 32;

    private final SecureRandom secureRandom;

    public SecureTokenCodec() {
        this(new SecureRandom());
    }

    SecureTokenCodec(SecureRandom secureRandom) {
        this.secureRandom = secureRandom;
    }

    public String generate() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(bytes);
    }

    public String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(
                    value.getBytes(java.nio.charset.StandardCharsets.UTF_8)
            );
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "SHA-256 is not available",
                    exception
            );
        }
    }
}
