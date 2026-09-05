package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.common.exception.CodeArchiveException;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
@Testcontainers
class RelaySessionBindingPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired JdbcTemplate db;
    @Autowired RelayGrantService grants;
    @Autowired SecureTokenCodec tokens;

    @AfterEach
    void clean() { db.update("DELETE FROM users"); }

    @Test
    void relayAuthenticationAndGenerationFenceAfterExpiryRevokeAndReplacement() {
        UUID user = user();
        UUID session = session(user, Instant.now().plusSeconds(3600));
        UUID grant = grant(user, session, 7);
        String raw = "relay-credential-" + UUID.randomUUID();
        db.update("UPDATE relay_grants SET token_hash=? WHERE id=?", tokens.hash(raw), grant);
        profile(user, session, 7);

        assertThat(grants.authenticate(raw)).isPresent();
        grants.requireCurrentGeneration(new RelayGrantPrincipal(user, grant, "device-1234567890", 7));
        db.update("UPDATE auth_sessions SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), session);
        assertThat(grants.authenticate(raw)).isEmpty();

        db.update("UPDATE auth_sessions SET expires_at=?,revoked_at=NULL WHERE id=?",
                Timestamp.from(Instant.now().plusSeconds(3600)), session);
        assertThat(grants.authenticate(raw)).isPresent();
        db.update("UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=?", session);
        assertThat(grants.authenticate(raw)).isEmpty();

        UUID replacement = session(user, Instant.now().plusSeconds(3600));
        db.update("UPDATE automation_profiles SET auth_session_id=?,generation=8 WHERE user_id=?", replacement, user);
        assertThatThrownBy(() -> grants.requireCurrentGeneration(
                new RelayGrantPrincipal(user, grant, "device-1234567890", 7)))
                .isInstanceOf(CodeArchiveException.class);
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        db.update("INSERT INTO users(id,github_user_id,github_login,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                id, Math.abs(UUID.randomUUID().getMostSignificantBits()), "relay-test-" + id, "Relay", Timestamp.from(now), Timestamp.from(now));
        return id;
    }

    private UUID session(UUID user, Instant expires) {
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
                id, user, UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""),
                Timestamp.from(expires), Timestamp.from(Instant.now()));
        return id;
    }

    private UUID grant(UUID user, UUID session, long generation) {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        db.update("""
                INSERT INTO relay_grants(id,user_id,auth_session_id,device_id,generation,public_key_hash,token_hash,issued_at,expires_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                """, id, user, session, "device-1234567890", generation, "a".repeat(64), "b".repeat(64),
                Timestamp.from(now), Timestamp.from(now.plusSeconds(3600)));
        return id;
    }

    private void profile(UUID user, UUID session, long generation) {
        db.update("""
                INSERT INTO automation_profiles(user_id,device_id,generation,source_transfer_enabled,
                    github_auto_commit_enabled,ownership_mode,auth_session_id,updated_at)
                VALUES(?,?,?,TRUE,FALSE,'DURABLE_SERVER',?,clock_timestamp())
                """, user, "device-1234567890", generation, session);
    }
}
