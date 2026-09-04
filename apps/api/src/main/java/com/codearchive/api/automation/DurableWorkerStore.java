package com.codearchive.api.automation;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;
import com.codearchive.api.integration.github.GitHubAppClient;
import com.fasterxml.jackson.databind.ObjectMapper;

@Repository
public class DurableWorkerStore {

    public static final long CLAIM_LEASE_SECONDS = 60;

    private final NamedParameterJdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public DurableWorkerStore(NamedParameterJdbcTemplate db, ObjectMapper json,
            PlatformTransactionManager transactions) {
        this.db = db;
        this.json = json;
        this.tx = new TransactionTemplate(transactions);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(15);
    }

    public Optional<Claim> claimNext() {
        try {
            return tx.execute(status -> {
                db.getJdbcTemplate().execute("SET LOCAL lock_timeout = '2s'");
                Candidate candidate = db.query("""
                        SELECT p.user_id,p.generation,p.target_generation,p.target,p.github_enabled_at,
                               p.version,p.device_id
                        FROM automation_profiles p
                        WHERE p.ownership_mode='DURABLE_SERVER'
                          AND p.source_transfer_enabled=true
                          AND p.github_auto_commit_enabled=true
                          AND p.automatic_transfer_consent=true
                          AND p.visibility_risk_consent=true
                          AND p.target IS NOT NULL AND p.github_enabled_at IS NOT NULL
                        ORDER BY p.updated_at,p.user_id
                        FOR UPDATE SKIP LOCKED
                        """, (rs, index) -> new Candidate(rs.getObject("user_id", UUID.class),
                                rs.getLong("generation"), rs.getLong("target_generation"), decode(rs.getString("target")),
                                rs.getTimestamp("github_enabled_at").toInstant(), rs.getLong("version"),
                                rs.getString("device_id"))).stream().findFirst().orElse(null);
                if (candidate == null) return Optional.empty();

                UUID solution = db.query("""
                        SELECT s.id FROM solutions s
                        WHERE s.user_id=:user AND s.accepted_capture=true AND s.result='ACCEPTED'
                          AND s.capture_generation=:generation
                          AND s.captured_at >= :enabledAt AND s.captured_at <= clock_timestamp()
                          AND NOT EXISTS (SELECT 1 FROM durable_github_attempts a
                                          WHERE a.user_id=s.user_id AND a.solution_id=s.id
                                            AND (a.state IN ('ATTEMPTED','SUCCEEDED','UNKNOWN','REJECTED')
                                                 OR (a.state='CLAIMED' AND a.lease_until>clock_timestamp())))
                          AND NOT EXISTS (SELECT 1 FROM github_auto_attempts a
                                          WHERE a.user_id=s.user_id AND a.solution_id=s.id)
                        ORDER BY s.captured_at,s.id LIMIT 1
                        """, new MapSqlParameterSource("user", candidate.userId())
                        .addValue("generation", candidate.generation())
                        .addValue("enabledAt", candidate.githubEnabledAt()),
                        (rs, index) -> rs.getObject(1, UUID.class)).stream().findFirst().orElse(null);
                if (solution == null) return Optional.empty();

                UUID id = UUID.randomUUID();
                String claimToken = tokens();
                try {
                    int reclaimed = db.update("""
                            UPDATE durable_github_attempts SET id=:id,profile_generation=:generation,
                            target_generation=:targetGeneration,state='CLAIMED',claim_token=:claimToken,
                            lease_until=clock_timestamp()+interval '60 seconds',created_at=clock_timestamp(),
                            completed_at=NULL,commit_sha=NULL,commit_url=NULL,error_code=NULL
                            WHERE user_id=:user AND solution_id=:solution AND state='CLAIMED'
                              AND lease_until<=clock_timestamp()
                            """, new MapSqlParameterSource("id", id).addValue("user", candidate.userId())
                            .addValue("solution", solution).addValue("generation", candidate.generation())
                            .addValue("targetGeneration", candidate.targetGeneration()).addValue("claimToken", claimToken));
                    if (reclaimed == 0) db.update("""
                            INSERT INTO durable_github_attempts
                                (id,user_id,solution_id,profile_generation,target_generation,state,claim_token,lease_until)
                            VALUES (:id,:user,:solution,:generation,:targetGeneration,'CLAIMED',:claimToken,
                                    clock_timestamp() + interval '60 seconds')
                            """, new MapSqlParameterSource("id", id).addValue("user", candidate.userId())
                                    .addValue("solution", solution).addValue("generation", candidate.generation())
                                    .addValue("targetGeneration", candidate.targetGeneration()).addValue("claimToken", claimToken));
                } catch (DuplicateKeyException ignored) {
                    return Optional.empty();
                }
                Instant leaseUntil = db.queryForObject(
                        "SELECT lease_until FROM durable_github_attempts WHERE id=:id",
                        new MapSqlParameterSource("id", id),
                        (rs, index) -> rs.getTimestamp(1).toInstant());
                return Optional.of(new Claim(id, candidate.userId(), solution, candidate.generation(),
                        candidate.targetGeneration(), candidate.target(), candidate.githubEnabledAt(), leaseUntil, claimToken));
            });
        } catch (DuplicateKeyException ignored) {
            return Optional.empty();
        }
    }

    public void markAttempted(Claim claim) {
        int updated = tx.execute(status -> db.update("""
                UPDATE durable_github_attempts SET state='ATTEMPTED',lease_until=clock_timestamp()+interval '60 seconds'
                WHERE id=:id AND claim_token=:claimToken AND state='CLAIMED' AND lease_until>clock_timestamp()
                """, new MapSqlParameterSource("id", claim.id()).addValue("claimToken", claim.claimToken())));
        if (updated != 1) throw new CodeArchiveException(ErrorCode.AUTOMATION_GENERATION_STALE);
    }

    public void requireLive(Claim claim) {
        boolean live = db.query("""
                SELECT 1 FROM automation_profiles p JOIN durable_github_attempts a ON a.user_id=p.user_id
                WHERE a.id=:id AND a.claim_token=:claimToken AND a.state='CLAIMED'
                  AND a.lease_until>clock_timestamp() AND p.user_id=:user
                  AND p.ownership_mode='DURABLE_SERVER' AND p.source_transfer_enabled=true
                  AND p.github_auto_commit_enabled=true AND p.generation=a.profile_generation
                  AND p.target_generation=a.target_generation
                FOR SHARE OF p,a
                """, new MapSqlParameterSource("id", claim.id()).addValue("claimToken", claim.claimToken())
                .addValue("user", claim.userId()), (rs, index) -> 1).stream().findFirst().isPresent();
        if (!live) throw new CodeArchiveException(ErrorCode.AUTOMATION_GENERATION_STALE);
    }

    public void finish(Claim claim, GitHubAppClient.CommitResult result, ErrorCode error, boolean dispatched) {
        tx.executeWithoutResult(status -> {
            String state = result != null ? "SUCCEEDED" : dispatched ? "UNKNOWN" : "REJECTED";
            int updated = db.update("""
                    UPDATE durable_github_attempts SET state=:state,completed_at=clock_timestamp(),
                    commit_sha=:sha,commit_url=:url,error_code=:error
                    WHERE id=:id AND claim_token=:claimToken AND state IN ('CLAIMED','ATTEMPTED')
                    """, new MapSqlParameterSource("state", state).addValue("sha", result == null ? null : result.sha())
                    .addValue("url", result == null ? null : result.url())
                    .addValue("error", error == null ? null : error.name()).addValue("id", claim.id())
                    .addValue("claimToken", claim.claimToken()));
            if (updated != 1 && !isFinished(claim)) throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR);
            if ("UNKNOWN".equals(state) || "REJECTED".equals(state)) {
                db.update("""
                        UPDATE automation_profiles SET github_auto_commit_enabled=false,updated_at=clock_timestamp()
                        WHERE user_id=:user AND generation=:generation AND target_generation=:targetGeneration
                        """, new MapSqlParameterSource("user", claim.userId())
                        .addValue("generation", claim.profileGeneration())
                        .addValue("targetGeneration", claim.targetGeneration()));
            }
            if ("SUCCEEDED".equals(state) && result != null) {
                db.update("""
                        UPDATE automation_profiles SET target=CAST(:target AS jsonb),updated_at=clock_timestamp()
                        WHERE user_id=:user AND generation=:generation AND target_generation=:targetGeneration
                          AND ownership_mode='DURABLE_SERVER'
                        """, new MapSqlParameterSource("user", claim.userId())
                        .addValue("generation", claim.profileGeneration())
                        .addValue("targetGeneration", claim.targetGeneration())
                        .addValue("target", encode(claim.target().withHead(result.sha()))));
            }
        });
    }

    public boolean hasBlockingAttempt(UUID userId) {
        return db.query("SELECT 1 FROM durable_github_attempts WHERE user_id=:user AND state IN ('ATTEMPTED','UNKNOWN') LIMIT 1",
                new MapSqlParameterSource("user", userId), (rs, index) -> 1).stream().findFirst().isPresent();
    }

    private boolean isFinished(Claim claim) {
        return db.query("SELECT 1 FROM durable_github_attempts WHERE id=:id AND state IN ('SUCCEEDED','REJECTED','UNKNOWN')",
                new MapSqlParameterSource("id", claim.id()), (rs, index) -> 1).stream().findFirst().isPresent();
    }

    private GitHubAutoCommitStore.Target decode(String value) {
        try { return json.readValue(value, GitHubAutoCommitStore.Target.class); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    private String encode(GitHubAutoCommitStore.Target value) {
        try { return json.writeValueAsString(value); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    private String tokens() {
        return UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
    }

    private record Candidate(UUID userId, long generation, long targetGeneration,
            GitHubAutoCommitStore.Target target, Instant githubEnabledAt, long version, String deviceId) {}

    public record Claim(UUID id, UUID userId, UUID solutionId, long profileGeneration,
            long targetGeneration, GitHubAutoCommitStore.Target target, Instant githubEnabledAt,
            Instant leaseUntil, String claimToken) {}
}
