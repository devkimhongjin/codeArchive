package com.codearchive.api.auth.session;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Atomically fences prior account authority before issuing a replacement session. */
@Service
public class AuthSessionReplacementService {

    private final NamedParameterJdbcTemplate db;
    private final TransactionTemplate tx;

    public AuthSessionReplacementService(NamedParameterJdbcTemplate db,
            PlatformTransactionManager transactions) {
        this.db = db;
        this.tx = new TransactionTemplate(transactions);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(15);
    }

    public Issued replace(UUID authenticatedPriorUserId, UUID authenticatedPriorSessionId,
            UUID newUserId, String tokenHash, Instant expiresAt, Instant now) {
        if (newUserId == null || tokenHash == null || expiresAt == null || now == null) {
            throw new IllegalArgumentException("session replacement context is incomplete");
        }
        return tx.execute(status -> {
            List<UUID> users = authenticatedPriorUserId == null
                    || authenticatedPriorUserId.equals(newUserId)
                    ? List.of(newUserId)
                    : List.of(authenticatedPriorUserId, newUserId).stream().sorted().toList();
            // User-row locks serialize same-user replacements and impose a stable
            // order for A->B transitions, preventing two active final sessions.
            db.query("SELECT id FROM users WHERE id IN (:users) ORDER BY id FOR UPDATE",
                    new MapSqlParameterSource("users", users), (rs, index) -> rs.getObject(1, UUID.class));
            MapSqlParameterSource args = new MapSqlParameterSource("users", users)
                    .addValue("now", Timestamp.from(now));
            db.update("UPDATE relay_grants SET revoked_at=:now WHERE user_id IN (:users) AND revoked_at IS NULL", args);
            db.update("""
                    UPDATE automation_profiles SET generation=generation+1,
                    source_transfer_enabled=false,github_auto_commit_enabled=false,
                    ownership_mode='PAGE_OWNED',target=null,
                    automatic_transfer_consent=false,visibility_risk_consent=false,
                    public_upload_consent=false,github_enabled_at=null,auth_session_id=null,
                    version=version+1,updated_at=:now
                    WHERE user_id IN (:users)
                    """, args);
            db.update("UPDATE github_auto_runs SET state='OFF',error_code='AUTOMATION_OWNERSHIP_CONFLICT' "
                    + "WHERE user_id IN (:users) AND state IN ('STARTING','ACTIVE')", args);
            if (authenticatedPriorSessionId != null && authenticatedPriorUserId != null) {
                db.update("UPDATE auth_sessions SET revoked_at=:now WHERE id=:prior "
                        + "AND user_id=:priorUser AND revoked_at IS NULL", args
                        .addValue("prior", authenticatedPriorSessionId)
                        .addValue("priorUser", authenticatedPriorUserId));
            }
            db.update("UPDATE auth_sessions SET revoked_at=:now WHERE user_id IN (:users) AND revoked_at IS NULL", args);

            UUID sessionId = UUID.randomUUID();
            db.update("""
                    INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at)
                    VALUES(:id,:user,:tokenHash,:expires,:created)
                    """, new MapSqlParameterSource().addValue("id", sessionId).addValue("user", newUserId)
                    .addValue("tokenHash", tokenHash).addValue("expires", Timestamp.from(expiresAt))
                    .addValue("created", Timestamp.from(now)));
            return new Issued(sessionId, expiresAt);
        });
    }

    public record Issued(UUID sessionId, Instant expiresAt) {}
}
