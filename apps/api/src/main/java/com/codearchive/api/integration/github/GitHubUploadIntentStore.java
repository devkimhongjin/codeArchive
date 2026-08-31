package com.codearchive.api.integration.github;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Repository
public class GitHubUploadIntentStore {
    private final NamedParameterJdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public GitHubUploadIntentStore(NamedParameterJdbcTemplate db, ObjectMapper json, PlatformTransactionManager transactions) {
        this.db = db; this.json = json;
        tx = new TransactionTemplate(transactions);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.setTimeout(5);
    }

    public Intent create(CodeArchivePrincipal principal, Review review) {
        return tx.execute(status -> {
            // Bound pending confirmations per account, serializing only this short database operation.
            db.getJdbcTemplate().execute("SET LOCAL lock_timeout = '2s'");
            db.queryForObject("SELECT id FROM users WHERE id = :user FOR UPDATE", Map.of("user", principal.userId()), UUID.class);
            int pending = db.queryForObject("""
                    SELECT count(*) FROM github_upload_intents
                    WHERE user_id = :user AND status = 'READY' AND expires_at > clock_timestamp()
                    """, Map.of("user", principal.userId()), Integer.class);
            if (pending >= 20) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
            UUID id = UUID.randomUUID();
            var selection = review.selection();
            String operation = encode(new Operation(selection.repositoryId(), selection.branch(), selection.expectedCommitSha(), selection.path()));
            var args = new MapSqlParameterSource("id", id).addValue("user", principal.userId()).addValue("session", principal.sessionId())
                    .addValue("hash", hash(operation)).addValue("review", encode(review));
            db.update("""
                    INSERT INTO github_upload_intents(id,user_id,session_id,operation_hash,review,expires_at)
                    VALUES(:id,:user,:session,:hash,CAST(:review AS jsonb),clock_timestamp() + interval '10 minutes')
                    """, args);
            return find(principal, id);
        });
    }

    public Intent find(CodeArchivePrincipal principal, UUID id) { return find(principal, id, false); }

    private Intent find(CodeArchivePrincipal principal, UUID id, boolean lock) {
        return db.query("""
                SELECT id, review, status, expires_at, commit_sha, commit_url, error_code
                FROM github_upload_intents WHERE id=:id AND user_id=:user AND session_id=:session
                """ + (lock ? " FOR UPDATE" : ""), args(principal, id), (row, index) -> new Intent(row.getObject("id", UUID.class),
                        decode(row.getString("review")), row.getString("status"), row.getTimestamp("expires_at").toInstant(),
                        row.getString("commit_sha"), row.getString("commit_url"), row.getString("error_code")))
                .stream().findFirst().orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_INTENT_NOT_FOUND));
    }

    public Claim claim(CodeArchivePrincipal principal, UUID id) {
        try {
            return tx.execute(status -> {
                db.getJdbcTemplate().execute("SET LOCAL lock_timeout = '2s'");
                Intent intent = find(principal, id, true);
                if (!intent.status().equals("READY")) return new Claim(intent, false);
                if (!intent.expiresAt().isAfter(Instant.now())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED);
                db.update("UPDATE github_upload_intents SET status='ATTEMPTED', attempted_at=clock_timestamp() WHERE id=:id", Map.of("id", id));
                return new Claim(intent, true);
            });
        } catch (DuplicateKeyException ignored) {
            throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        }
    }

    public void finish(UUID id, String state, GitHubAppClient.CommitResult result, ErrorCode error) {
        tx.executeWithoutResult(status -> {
            var args = new MapSqlParameterSource("id", id).addValue("state", state)
                    .addValue("sha", result == null ? null : result.sha()).addValue("url", result == null ? null : result.url())
                    .addValue("error", error == null ? null : error.name());
            if (db.update("""
                    UPDATE github_upload_intents SET status=:state, completed_at=clock_timestamp(),
                    commit_sha=:sha, commit_url=:url, error_code=:error WHERE id=:id AND status='ATTEMPTED'
                    """, args) != 1) throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR);
        });
    }

    private Map<String, Object> args(CodeArchivePrincipal principal, UUID id) {
        return Map.of("id", id, "user", principal.userId(), "session", principal.sessionId());
    }
    private String encode(Object value) {
        try { return json.writeValueAsString(value); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }
    private Review decode(String value) {
        try { return json.readValue(value, Review.class); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }
    static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    private record Operation(long repositoryId, String branch, String head, String path) {}
    public record Review(GitHubUploadPreviewService.Request selection, String sourceSha256, boolean privateRepository, String fullName) {
        @Override public String toString() { return "UploadReview[redacted]"; }
    }
    public record Intent(UUID id, Review review, String status, Instant expiresAt, String commitSha, String commitUrl, String errorCode) {
        @Override public String toString() { return "UploadIntent[redacted]"; }
    }
    public record Claim(Intent intent, boolean acquired) {}
}
