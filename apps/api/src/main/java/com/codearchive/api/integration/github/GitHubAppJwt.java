package com.codearchive.api.integration.github;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class GitHubAppJwt {
    private final GitHubAppProperties properties;
    private final ObjectMapper mapper;
    private final Clock clock;

    @Autowired
    public GitHubAppJwt(GitHubAppProperties properties, ObjectMapper mapper) {
        this(properties, mapper, Clock.systemUTC());
    }

    GitHubAppJwt(GitHubAppProperties properties, ObjectMapper mapper, Clock clock) {
        this.properties = properties;
        this.mapper = mapper;
        this.clock = clock;
    }

    // No startup parsing: an unconfigured integration must not disable ordinary login.
    public String issue() {
        try {
            if (!properties.isEnabled() || properties.getAppId() == null
                    || !properties.getAppId().matches("[1-9][0-9]{0,18}")) {
                throw new IllegalArgumentException();
            }
            String pem = properties.getPrivateKeyPkcs8();
            if (pem == null || !pem.strip().startsWith("-----BEGIN PRIVATE KEY-----")
                    || !pem.strip().endsWith("-----END PRIVATE KEY-----")) {
                throw new IllegalArgumentException();
            }
            byte[] der = Base64.getDecoder().decode(pem
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", ""));
            RSAPrivateKey key = (RSAPrivateKey) KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(der));
            if (key.getModulus().bitLength() < 2048) {
                throw new IllegalArgumentException();
            }
            long now = clock.instant().getEpochSecond();
            String content = encode(mapper.writeValueAsBytes(Map.of("alg", "RS256", "typ", "JWT")))
                    + "." + encode(mapper.writeValueAsBytes(Map.of(
                            "iss", properties.getAppId(), "iat", now - 60, "exp", now + 300)));
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign(key);
            signature.update(content.getBytes(StandardCharsets.US_ASCII));
            return content + "." + encode(signature.sign());
        } catch (Exception ignored) {
            // Do not retain cryptography/provider exceptions containing credential material.
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        }
    }

    private static String encode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}

