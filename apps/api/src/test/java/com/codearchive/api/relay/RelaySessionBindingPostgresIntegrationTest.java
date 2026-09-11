package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.community.CommunityDefaultPublicPolicy;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"
})
@Testcontainers
@AutoConfigureMockMvc
class RelaySessionBindingPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired JdbcTemplate db;
    @Autowired RelayGrantService grants;
    @Autowired SecureTokenCodec tokens;
    @Autowired MockMvc mvc;

    @Test
    void realGrantTraversesFullChainAndPersistsIdempotently() throws Exception {
        UUID user = user();
        UUID session = session(user, Instant.now().plusSeconds(3600));
        UUID grant = grant(user, session, 7);
        String raw = "synthetic-relay-" + UUID.randomUUID();
        db.update("UPDATE relay_grants SET token_hash=? WHERE id=?", tokens.hash(raw), grant);
        profile(user, session, 7);

        String capture = """
                {"records":[{"clientRecordId":"synthetic-relay-record","platform":"PROGRAMMERS",
                "problemNumber":"1234","title":"Synthetic capture","language":"Java",
                "code":"class Synthetic {}","result":"ACCEPTED",
                "solvedAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z",
                "capturedAt":"2026-09-01T00:00:00Z","aiUsage":"unknown"}]}
                """;
        for (String outcome : new String[] {"IMPORTED", "EXISTING"}) {
            mvc.perform(post("/api/v1/relay/captures")
                            .header("Origin", "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl")
                            .header("Authorization", "Bearer " + raw)
                            .contentType(MediaType.APPLICATION_JSON).content(capture))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.success").value(true))
                    .andExpect(jsonPath("$.data.results[0].outcome").value(outcome))
                    .andExpect(jsonPath("$.data.results[0].ackEligible").value(true));
        }
        assertThat(db.queryForObject("SELECT count(*) FROM solutions WHERE user_id=?", Long.class, user))
                .isEqualTo(1);
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE user_id=?", Boolean.class, user))
                .isFalse();

        db.update("UPDATE relay_grants SET revoked_at=clock_timestamp() WHERE id=?", grant);
        assertThat(grants.authenticationRejectionReason(raw)).isEqualTo("GRANT_REVOKED");
        mvc.perform(post("/api/v1/relay/captures")
                        .header("Authorization", "Bearer " + raw)
                        .contentType(MediaType.APPLICATION_JSON).content(capture))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
    }

    @Test
    void currentPolicyMakesOnlyImportedRelayCapturePublicAndDuplicateDoesNotChangePrivateState() throws Exception {
        UUID user = user();
        UUID session = session(user, Instant.now().plusSeconds(3600));
        UUID grant = grant(user, session, 7);
        String raw = "relay-public-" + UUID.randomUUID();
        db.update("UPDATE relay_grants SET token_hash=? WHERE id=?", tokens.hash(raw), grant);
        profile(user, session, 7);
        enableCommunityDefaultPublic(user, session, 7);

        Instant before = Instant.now();
        String capture = capture("public-record");
        mvc.perform(post("/api/v1/relay/captures")
                        .header("Origin", "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl")
                        .header("Authorization", "Bearer " + raw)
                        .contentType(MediaType.APPLICATION_JSON).content(capture))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].outcome").value("IMPORTED"));
        Instant published = db.queryForObject("SELECT published_at FROM solutions WHERE user_id=? AND client_record_id=?",
                Timestamp.class, user, "public-record").toInstant();
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE user_id=? AND client_record_id=?",
                Boolean.class, user, "public-record")).isTrue();
        assertThat(published).isBetween(before, Instant.now());

        db.update("UPDATE solutions SET community_public=false,published_at=NULL WHERE user_id=? AND client_record_id=?",
                user, "public-record");
        mvc.perform(post("/api/v1/relay/captures")
                        .header("Authorization", "Bearer " + raw)
                        .contentType(MediaType.APPLICATION_JSON).content(capture))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].outcome").value("EXISTING"));
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE user_id=? AND client_record_id=?",
                Boolean.class, user, "public-record")).isFalse();
        assertThat(db.queryForObject("SELECT published_at FROM solutions WHERE user_id=? AND client_record_id=?",
                Timestamp.class, user, "public-record")).isNull();
    }

    @Test
    void oldGenerationLosesDefaultPublicAuthorityAfterSessionReplacement() {
        UUID user = user();
        UUID session = session(user, Instant.now().plusSeconds(3600));
        UUID grant = grant(user, session, 7);
        profile(user, session, 7);
        enableCommunityDefaultPublic(user, session, 7);
        assertThat(grants.communityDefaultPublicEligible(
                new RelayGrantPrincipal(user, grant, "device-1234567890", 7))).isTrue();

        UUID replacement = session(user, Instant.now().plusSeconds(3600));
        db.update("UPDATE automation_profiles SET auth_session_id=?,generation=8 WHERE user_id=?", replacement, user);
        assertThat(grants.communityDefaultPublicEligible(
                new RelayGrantPrincipal(user, grant, "device-1234567890", 7))).isFalse();
    }

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
        assertThat(grants.authenticationRejectionReason(raw)).isEqualTo("VALID_AT_DIAGNOSTIC_CHECK");
        assertThat(grants.authenticationRejectionReason("synthetic-unrecognized" )).isEqualTo("TOKEN_NOT_FOUND");
        grants.requireCurrentGeneration(new RelayGrantPrincipal(user, grant, "device-1234567890", 7));
        db.update("UPDATE auth_sessions SET expires_at=? WHERE id=?", Timestamp.from(Instant.now().minusSeconds(1)), session);
        assertThat(grants.authenticate(raw)).isEmpty();
        assertThat(grants.authenticationRejectionReason(raw)).isEqualTo("SESSION_EXPIRED");

        db.update("UPDATE auth_sessions SET expires_at=?,revoked_at=NULL WHERE id=?",
                Timestamp.from(Instant.now().plusSeconds(3600)), session);
        assertThat(grants.authenticate(raw)).isPresent();
        db.update("UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=?", session);
        assertThat(grants.authenticate(raw)).isEmpty();
        assertThat(grants.authenticationRejectionReason(raw)).isEqualTo("SESSION_REVOKED");

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

    private void enableCommunityDefaultPublic(UUID user, UUID session, long generation) {
        db.update("""
                UPDATE automation_profiles SET community_default_public_policy_version=?,
                    community_default_public_consented_at=clock_timestamp(),
                    community_default_public_auth_session_id=?,community_default_public_generation=?
                WHERE user_id=?
                """, CommunityDefaultPublicPolicy.CURRENT_VERSION, session, generation, user);
    }

    private String capture(String clientRecordId) {
        return """
                {"records":[{"clientRecordId":"%s","platform":"PROGRAMMERS",
                "problemNumber":"1234","title":"Synthetic capture","language":"Java",
                "code":"class Synthetic {}","result":"ACCEPTED",
                "solvedAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z",
                "capturedAt":"2026-09-01T00:00:00Z","aiUsage":"unknown"}]}
                """.formatted(clientRecordId);
    }
}
