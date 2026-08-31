package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;

import org.junit.jupiter.api.Test;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;

class GitHubAppJwtTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void signsVerifiableRsaJwtWithClockSkewAndBoundedLifetime() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keys = generator.generateKeyPair();
        GitHubAppProperties properties = configured();
        properties.setPrivateKeyPkcs8("-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(keys.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----");
        Instant now = Instant.parse("2026-08-31T12:00:00Z");

        String token = new GitHubAppJwt(properties, mapper,
                Clock.fixed(now, ZoneOffset.UTC)).issue();
        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        var header = mapper.readTree(Base64.getUrlDecoder().decode(parts[0]));
        var claims = mapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
        assertThat(header.path("alg").textValue()).isEqualTo("RS256");
        assertThat(claims.path("iss").textValue()).isEqualTo("1234");
        assertThat(claims.path("iat").longValue()).isEqualTo(now.getEpochSecond() - 60);
        assertThat(claims.path("exp").longValue()).isEqualTo(now.getEpochSecond() + 300);
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(keys.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(verifier.verify(Base64.getUrlDecoder().decode(parts[2]))).isTrue();
    }

    @Test
    void disabledConfigurationIsLazyAndFailsClosedWithoutCredentialDetails() {
        GitHubAppProperties properties = new GitHubAppProperties();
        GitHubAppJwt signer = new GitHubAppJwt(properties, mapper);
        assertUnavailable(signer);
    }

    @Test
    void malformedKeyDoesNotExposeItsValueOrCryptographyCause() {
        GitHubAppProperties properties = configured();
        properties.setPrivateKeyPkcs8("private-key-canary");
        assertUnavailable(new GitHubAppJwt(properties, mapper));
    }

    @Test
    void nonNumericAppIdCannotBeInterpolatedIntoClaims() {
        GitHubAppProperties properties = configured();
        properties.setAppId("123\",\"exp\":999999999999");
        assertUnavailable(new GitHubAppJwt(properties, mapper));
    }

    private static GitHubAppProperties configured() {
        GitHubAppProperties result = new GitHubAppProperties();
        result.setEnabled(true);
        result.setAppId("1234");
        return result;
    }

    private static void assertUnavailable(GitHubAppJwt signer) {
        assertThatThrownBy(signer::issue).isInstanceOf(CodeArchiveException.class)
                .satisfies(failure -> {
                    assertThat(((CodeArchiveException) failure).getErrorCode())
                            .isEqualTo(ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
                    assertThat(failure.getCause()).isNull();
                    assertThat(failure.getMessage()).doesNotContain("private-key-canary");
                });
    }
}

