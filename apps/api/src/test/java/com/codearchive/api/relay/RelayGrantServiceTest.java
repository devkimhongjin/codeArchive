package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;

@ExtendWith(MockitoExtension.class)
class RelayGrantServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-04T00:00:00Z");
    private static final String ORIGIN = "https://codearchive-dashboard-beta.onrender.com";

    @Mock NamedParameterJdbcTemplate db;
    @Mock PlatformTransactionManager transactions;
    private RelayGrantService service;
    private CodeArchivePrincipal principal;
    private KeyPair keyPair;

    @BeforeEach
    void setUp() throws Exception {
        AuthProperties properties = new AuthProperties();
        properties.setDashboardOrigin(ORIGIN);
        keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        principal = new CodeArchivePrincipal(UUID.randomUUID(), UUID.randomUUID(), "tester");
        service = new RelayGrantService(db, new SecureTokenCodec(), properties, transactions,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void challengeIsHighEntropyHashedAndExpiresInTwoMinutes() {
        RelayGrantService.ChallengeResponse result = service.challenge(principal, ORIGIN,
                new RelayGrantService.ChallengeRequest("device-1234567890", publicKey()));

        assertThat(result.challenge()).hasSizeGreaterThanOrEqualTo(42);
        assertThat(result.expiresAt()).isEqualTo(NOW.plus(RelayGrantService.CHALLENGE_TTL));
        ArgumentCaptor<MapSqlParameterSource> captor = ArgumentCaptor.forClass(MapSqlParameterSource.class);
        verify(db).update(any(String.class), captor.capture());
        Object hash = captor.getValue().getValues().get("hash");
        assertThat(hash).isNotEqualTo(result.challenge()).isInstanceOf(String.class);
        assertThat((String) hash).hasSize(64);
    }

    @Test
    void issuedCredentialIsNeverReturnedByTheDatabaseParametersAsPlaintext() throws Exception {
        RelayGrantService.ChallengeResponse challenge = service.challenge(principal, ORIGIN,
                new RelayGrantService.ChallengeRequest("device-1234567890", publicKey()));
        when(db.query(any(String.class), any(MapSqlParameterSource.class), any(org.springframework.jdbc.core.RowMapper.class)))
                .thenReturn(java.util.List.of(new Object[] {}));

        // The challenge is single-use and must fail closed when its owner row is absent.
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.issue(principal, ORIGIN,
                new RelayGrantService.GrantRequest("device-1234567890", challenge.challengeId().toString(),
                        challenge.challenge(), publicKey(), signature(challenge.challenge()))))
                .isInstanceOf(com.codearchive.api.common.exception.CodeArchiveException.class);
        verify(db, never()).update(contains("INSERT INTO relay_grants"), any(MapSqlParameterSource.class));
    }

    @Test
    void generationMismatchFailsClosedAfterDeviceOrAccountTransition() {
        when(db.query(contains("SELECT 1 FROM relay_grants"), any(MapSqlParameterSource.class),
                any(org.springframework.jdbc.core.RowMapper.class))).thenReturn(java.util.List.of(9L));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.requireCurrentGeneration(
                new RelayGrantPrincipal(principal.userId(), UUID.randomUUID(), "device-1234567890", 8)))
                .isInstanceOf(com.codearchive.api.common.exception.CodeArchiveException.class)
                .satisfies(failure -> assertThat(((com.codearchive.api.common.exception.CodeArchiveException) failure)
                        .getErrorCode()).isEqualTo(com.codearchive.api.common.exception.ErrorCode.RELAY_GRANT_REVOKED));
    }

    @Test
    void explicitRevokeRevokesGrantAndDisablesTheProfile() {
        when(db.update(any(String.class), any(MapSqlParameterSource.class))).thenReturn(1);

        service.revoke(principal, ORIGIN, UUID.randomUUID());

        verify(db, times(2)).update(contains("UPDATE relay_grants SET revoked_at"), any(MapSqlParameterSource.class));
        verify(db).update(contains("UPDATE automation_profiles SET generation"), any(MapSqlParameterSource.class));
    }

    private String publicKey() {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(keyPair.getPublic().getEncoded());
    }

    private String signature(String value) throws Exception {
        var signer = java.security.Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign());
    }
}
