package com.codearchive.api.relay;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.config.DashboardOriginValidator;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class RelayGrantService {

    public static final Duration CHALLENGE_TTL = Duration.ofMinutes(2);
    public static final Duration GRANT_TTL = Duration.ofDays(30);
    private static final int MAX_DEVICE_ID = 128;

    private final NamedParameterJdbcTemplate db;
    private final SecureTokenCodec tokens;
    private final AuthProperties authProperties;
    private final TransactionTemplate tx;
    private final Clock clock;

    @Autowired
    public RelayGrantService(
            NamedParameterJdbcTemplate db,
            SecureTokenCodec tokens,
            AuthProperties authProperties,
            PlatformTransactionManager transactions
    ) {
        this(db, tokens, authProperties, transactions, Clock.systemUTC());
    }

    RelayGrantService(
            NamedParameterJdbcTemplate db,
            SecureTokenCodec tokens,
            AuthProperties authProperties,
            PlatformTransactionManager transactions,
            Clock clock
    ) {
        this.db = db;
        this.tokens = tokens;
        this.authProperties = authProperties;
        this.clock = clock;
        this.tx = new TransactionTemplate(transactions);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(10);
    }

    public ChallengeResponse challenge(
            CodeArchivePrincipal principal,
            String origin,
            ChallengeRequest request
    ) {
        requireDashboard(principal, origin);
        String device = deviceId(request == null ? null : request.deviceId());
        String publicKey = required(request == null ? null : request.publicKey(), 2048);
        decodePublicKey(publicKey);
        String rawChallenge = tokens.generate();
        Instant now = clock.instant();
        Instant expires = now.plus(CHALLENGE_TTL);
        UUID id = UUID.randomUUID();

        tx.executeWithoutResult(status -> db.update("""
                INSERT INTO relay_pairing_challenges
                    (id,user_id,session_id,device_id,public_key,challenge_hash,expires_at,created_at)
                VALUES (:id,:user,:session,:device,:key,:hash,:expires,:created)
                """, new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("user", principal.userId())
                .addValue("session", principal.sessionId())
                .addValue("device", device)
                .addValue("key", publicKey)
                .addValue("hash", tokens.hash(rawChallenge))
                .addValue("expires", Timestamp.from(expires))
                .addValue("created", Timestamp.from(now))));
        return new ChallengeResponse(id, rawChallenge, expires);
    }

    public GrantResponse issue(
            CodeArchivePrincipal principal,
            String origin,
            GrantRequest request
    ) {
        requireDashboard(principal, origin);
        if (request == null) throw invalid();
        String device = deviceId(request.deviceId());
        String publicKey = required(request.publicKey(), 2048);
        String rawChallenge = required(request.challenge(), 256);
        String signature = required(request.signature(), 512);
        UUID challengeId = parseUuid(request.challengeId());
        verifySignature(publicKey, rawChallenge, signature);

        return tx.execute(status -> {
            var row = db.query("""
                    SELECT public_key, challenge_hash, expires_at, consumed_at
                    FROM relay_pairing_challenges
                    WHERE id=:id AND user_id=:user AND session_id=:session AND device_id=:device
                    FOR UPDATE
                    """, new MapSqlParameterSource()
                    .addValue("id", challengeId)
                    .addValue("user", principal.userId())
                    .addValue("session", principal.sessionId())
                    .addValue("device", device), (rs, index) -> new ChallengeRow(
                            rs.getString("public_key"), rs.getString("challenge_hash"),
                            rs.getTimestamp("expires_at").toInstant(), rs.getTimestamp("consumed_at")))
                    .stream().findFirst().orElseThrow(this::invalid);
            Instant now = clock.instant();
            if (row.consumedAt() != null || !row.expiresAt().isAfter(now)
                    || !row.publicKey().equals(publicKey)
                    || !tokens.hash(rawChallenge).equals(row.challengeHash())) {
                throw invalid();
            }
            db.update("UPDATE relay_pairing_challenges SET consumed_at=:now WHERE id=:id",
                    new MapSqlParameterSource("now", Timestamp.from(now)).addValue("id", challengeId));

            long generation = profileForDevice(principal.userId(), device, now);
            db.update("UPDATE relay_grants SET revoked_at=:now WHERE user_id=:user AND revoked_at IS NULL",
                    new MapSqlParameterSource("now", Timestamp.from(now)).addValue("user", principal.userId()));

            UUID grantId = UUID.randomUUID();
            String rawToken = grantId + "." + tokens.generate();
            Instant expires = now.plus(GRANT_TTL);
            db.update("""
                    INSERT INTO relay_grants
                        (id,user_id,device_id,generation,public_key_hash,token_hash,issued_at,expires_at)
                    VALUES (:id,:user,:device,:generation,:keyHash,:tokenHash,:issued,:expires)
                    """, new MapSqlParameterSource()
                    .addValue("id", grantId)
                    .addValue("user", principal.userId())
                    .addValue("device", device)
                    .addValue("generation", generation)
                    .addValue("keyHash", tokens.hash(publicKey))
                    .addValue("tokenHash", tokens.hash(rawToken))
                    .addValue("issued", Timestamp.from(now))
                    .addValue("expires", Timestamp.from(expires)));
            return new GrantResponse(grantId, rawToken, device, generation, expires);
        });
    }

    public void revoke(CodeArchivePrincipal principal, String origin, UUID grantId) {
        requireDashboard(principal, origin);
        if (grantId == null) throw invalid();
        tx.executeWithoutResult(status -> {
            Instant now = clock.instant();
            int revoked = db.update("UPDATE relay_grants SET revoked_at=:now WHERE id=:id AND user_id=:user AND revoked_at IS NULL",
                    new MapSqlParameterSource("now", Timestamp.from(now)).addValue("id", grantId).addValue("user", principal.userId()));
            if (revoked != 1) throw invalid();
            db.update("UPDATE relay_grants SET revoked_at=:now WHERE user_id=:user AND revoked_at IS NULL",
                    new MapSqlParameterSource("now", Timestamp.from(now)).addValue("user", principal.userId()));
            disableProfile(principal.userId(), now);
        });
    }

    /** Rotation requires a fresh dashboard-authenticated proof of possession. */
    public GrantResponse rotate(CodeArchivePrincipal principal, String origin, UUID currentGrantId, GrantRequest request) {
        requireDashboard(principal, origin);
        if (currentGrantId == null) throw invalid();
        tx.executeWithoutResult(status -> {
            int revoked = db.update("""
                    UPDATE relay_grants SET revoked_at=:now
                    WHERE id=:id AND user_id=:user AND revoked_at IS NULL
                    """, new MapSqlParameterSource("now", Timestamp.from(clock.instant())).addValue("id", currentGrantId)
                    .addValue("user", principal.userId()));
            if (revoked != 1) throw invalid();
        });
        return issue(principal, origin, request);
    }

    public void revokeForUser(UUID userId) {
        if (userId == null) return;
        tx.executeWithoutResult(status -> {
            Instant now = clock.instant();
            db.update("UPDATE relay_grants SET revoked_at=:now WHERE user_id=:user AND revoked_at IS NULL",
                    new MapSqlParameterSource("now", Timestamp.from(now)).addValue("user", userId));
            disableProfile(userId, now);
        });
    }

    public Optional<RelayGrantPrincipal> authenticate(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return Optional.empty();
        Instant now = clock.instant();
        return db.query("""
                SELECT id,user_id,device_id,generation
                FROM relay_grants
                WHERE token_hash=:hash AND revoked_at IS NULL AND expires_at > :now
                """, new MapSqlParameterSource("hash", tokens.hash(rawToken)).addValue("now", Timestamp.from(now)),
                (rs, index) -> new RelayGrantPrincipal(rs.getObject("user_id", UUID.class),
                        rs.getObject("id", UUID.class), rs.getString("device_id"), rs.getLong("generation")))
                .stream().findFirst();
    }

    public void requireCurrentGeneration(RelayGrantPrincipal principal) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.RELAY_GRANT_INVALID);
        boolean valid = db.query("""
                SELECT generation FROM automation_profiles
                WHERE user_id=:user AND device_id=:device
                  AND source_transfer_enabled=true
                """, new MapSqlParameterSource("user", principal.userId()).addValue("device", principal.deviceId()),
                (rs, index) -> rs.getLong(1)).stream().findFirst()
                .map(generation -> generation == principal.generation())
                .orElse(false);
        if (!valid) throw new CodeArchiveException(ErrorCode.RELAY_GRANT_REVOKED);
    }

    private long profileForDevice(UUID userId, String device, Instant now) {
        var existing = db.query("SELECT device_id,generation FROM automation_profiles WHERE user_id=:user FOR UPDATE",
                new MapSqlParameterSource("user", userId), (rs, index) -> new ProfileRow(rs.getString(1), rs.getLong(2)))
                .stream().findFirst();
        if (existing.isEmpty()) {
            db.update("INSERT INTO automation_profiles(user_id,device_id,generation,updated_at) VALUES(:user,:device,1,:now)",
                    new MapSqlParameterSource("user", userId).addValue("device", device).addValue("now", Timestamp.from(now)));
            return 1;
        }
        ProfileRow profile = existing.get();
        if (!device.equals(profile.deviceId())) {
            long generation = profile.generation() + 1;
            db.update("""
                    UPDATE automation_profiles SET device_id=:device,generation=:generation,
                    source_transfer_enabled=false,github_auto_commit_enabled=false,
                    target=null,github_enabled_at=null,version=version+1,updated_at=:now
                    WHERE user_id=:user
                    """, new MapSqlParameterSource("device", device).addValue("generation", generation)
                    .addValue("now", Timestamp.from(now)).addValue("user", userId));
            return generation;
        }
        return profile.generation();
    }

    private void disableProfile(UUID userId, Instant now) {
        db.update("""
                UPDATE automation_profiles SET generation=generation+1,
                source_transfer_enabled=false,github_auto_commit_enabled=false,
                github_enabled_at=null,version=version+1,updated_at=:now
                WHERE user_id=:user
                """, new MapSqlParameterSource("user", userId).addValue("now", Timestamp.from(now)));
    }

    private void requireDashboard(CodeArchivePrincipal principal, String origin) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        String expected = DashboardOriginValidator.normalize(authProperties.getDashboardOrigin()).orElse(null);
        if (expected == null || !expected.equals(origin)) {
            throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
        }
    }

    private String deviceId(String value) {
        String normalized = required(value, MAX_DEVICE_ID);
        if (normalized.length() < 16 || !normalized.matches("[A-Za-z0-9_-]+")) throw invalid();
        return normalized;
    }

    private String required(String value, int max) {
        if (value == null || value.isBlank() || value.length() > max) throw invalid();
        return value.trim();
    }

    private UUID parseUuid(String value) {
        try { return UUID.fromString(required(value, 64)); }
        catch (RuntimeException ignored) { throw invalid(); }
    }

    private void verifySignature(String publicKey, String challenge, String signature) {
        try {
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(decodePublicKey(publicKey));
            verifier.update(challenge.getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(Base64.getUrlDecoder().decode(signature))) throw invalid();
        } catch (CodeArchiveException failure) {
            throw failure;
        } catch (Exception ignored) {
            throw invalid();
        }
    }

    private PublicKey decodePublicKey(String value) {
        try {
            byte[] encoded = Base64.getUrlDecoder().decode(value);
            if (encoded.length < 32 || encoded.length > 128) throw invalid();
            return KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(encoded));
        } catch (CodeArchiveException failure) {
            throw failure;
        } catch (Exception ignored) {
            throw invalid();
        }
    }

    private CodeArchiveException invalid() {
        return new CodeArchiveException(ErrorCode.INVALID_REQUEST);
    }

    private record ChallengeRow(String publicKey, String challengeHash, Instant expiresAt,
            java.sql.Timestamp consumedAt) {}
    private record ProfileRow(String deviceId, long generation) {}

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    public record ChallengeRequest(String deviceId, String publicKey) {}
    public record ChallengeResponse(UUID challengeId, String challenge, Instant expiresAt) {}
    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    public record GrantRequest(String deviceId, String challengeId, String challenge,
            String publicKey, String signature) {}
    public record GrantResponse(UUID grantId, String credential, String deviceId,
            long generation, Instant expiresAt) {}
}
