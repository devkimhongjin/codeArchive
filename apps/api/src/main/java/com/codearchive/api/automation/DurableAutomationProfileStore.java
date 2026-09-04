package com.codearchive.api.automation;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.Objects;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;
import com.fasterxml.jackson.databind.ObjectMapper;

@Repository
public class DurableAutomationProfileStore {

    private final NamedParameterJdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public DurableAutomationProfileStore(
            NamedParameterJdbcTemplate db,
            ObjectMapper json,
            PlatformTransactionManager transactions
    ) {
        this.db = db;
        this.json = json;
        this.tx = new TransactionTemplate(transactions);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(10);
    }

    public Profile find(UUID userId) {
        return db.query("""
                SELECT user_id,device_id,generation,source_transfer_enabled,github_auto_commit_enabled,
                       ownership_mode,target_generation,target,automatic_transfer_consent,
                       visibility_risk_consent,public_upload_consent,github_enabled_at,version,updated_at
                FROM automation_profiles WHERE user_id=:user
                """, new MapSqlParameterSource("user", userId), (rs, index) -> map(rs))
                .stream().findFirst().orElseGet(() -> Profile.off(userId));
    }

    public Profile update(
            UUID userId,
            String deviceId,
            boolean sourceTransferEnabled,
            boolean githubAutoCommitEnabled,
            String ownershipMode,
            long targetGeneration,
            GitHubAutoCommitStore.Target target,
            boolean automaticTransferConsent,
            boolean visibilityRiskConsent,
            boolean publicUploadConsent,
            long expectedVersion,
            Instant githubEnabledAt,
            long generation,
            Instant now
    ) {
        return tx.execute(status -> {
            Profile current = locked(userId);
            if (current.version() != expectedVersion) throw new CodeArchiveException(ErrorCode.AUTOMATION_GENERATION_STALE);
            boolean changed = current.sourceTransferEnabled() != sourceTransferEnabled
                    || current.githubAutoCommitEnabled() != githubAutoCommitEnabled
                    || !Objects.equals(current.deviceId(), deviceId)
                    || !Objects.equals(current.target(), target)
                    || !Objects.equals(current.ownershipMode(), ownershipMode)
                    || current.automaticTransferConsent() != automaticTransferConsent
                    || current.visibilityRiskConsent() != visibilityRiskConsent
                    || current.publicUploadConsent() != publicUploadConsent;
            if ("DURABLE_SERVER".equals(ownershipMode) && "PAGE_OWNED".equals(current.ownershipMode())) {
                stopPageOwnedRunsInTransaction(userId);
            }
            if ("PAGE_OWNED".equals(ownershipMode) && "DURABLE_SERVER".equals(current.ownershipMode())
                    && hasActiveDurableClaimInTransaction(userId)) {
                throw new CodeArchiveException(ErrorCode.AUTOMATION_OWNERSHIP_CONFLICT);
            }
            if (changed) revokeRelayGrantsInTransaction(userId, now);
            MapSqlParameterSource args = new MapSqlParameterSource()
                    .addValue("user", userId).addValue("device", deviceId)
                    .addValue("generation", generation).addValue("source", sourceTransferEnabled)
                    .addValue("github", githubAutoCommitEnabled).addValue("mode", ownershipMode)
                    .addValue("targetGeneration", targetGeneration).addValue("target", encode(target))
                    .addValue("automaticConsent", automaticTransferConsent)
                    .addValue("visibilityConsent", visibilityRiskConsent)
                    .addValue("publicConsent", publicUploadConsent)
                    .addValue("enabledAt", githubEnabledAt == null ? null : Timestamp.from(githubEnabledAt))
                    .addValue("version", current.version() + 1)
                    .addValue("now", Timestamp.from(now));
            db.update("""
                    UPDATE automation_profiles SET device_id=:device,generation=:generation,
                    source_transfer_enabled=:source,github_auto_commit_enabled=:github,
                    ownership_mode=:mode,target_generation=:targetGeneration,target=CAST(:target AS jsonb),
                    automatic_transfer_consent=:automaticConsent,visibility_risk_consent=:visibilityConsent,
                    public_upload_consent=:publicConsent,github_enabled_at=:enabledAt,
                    version=:version,updated_at=:now WHERE user_id=:user
                    """, args);
            return find(userId);
        });
    }

    public Profile withLock(UUID userId) {
        return locked(userId);
    }

    public void revokeRelayGrants(UUID userId, Instant now) {
        revokeRelayGrantsInTransaction(userId, now);
    }

    public void stopPageOwnedRuns(UUID userId) {
        stopPageOwnedRunsInTransaction(userId);
    }

    private void stopPageOwnedRunsInTransaction(UUID userId) {
        db.update("""
                UPDATE github_auto_runs SET state='OFF', error_code='AUTOMATION_OWNERSHIP_CONFLICT'
                WHERE user_id=:user AND state IN ('STARTING','ACTIVE')
                """, new MapSqlParameterSource("user", userId));
    }

    private void revokeRelayGrantsInTransaction(UUID userId, Instant now) {
        db.update("UPDATE relay_grants SET revoked_at=:now WHERE user_id=:user AND revoked_at IS NULL",
                new MapSqlParameterSource("user", userId).addValue("now", Timestamp.from(now)));
    }

    public boolean hasActiveDurableClaim(UUID userId) {
        return hasActiveDurableClaimInTransaction(userId);
    }

    private boolean hasActiveDurableClaimInTransaction(UUID userId) {
        return db.queryForObject("""
                SELECT count(*) FROM durable_github_attempts
                WHERE user_id=:user AND state='CLAIMED' AND lease_until > clock_timestamp()
                """, new MapSqlParameterSource("user", userId), Integer.class) > 0;
    }

    private Profile locked(UUID userId) {
        return db.query("""
                SELECT user_id,device_id,generation,source_transfer_enabled,github_auto_commit_enabled,
                       ownership_mode,target_generation,target,automatic_transfer_consent,
                       visibility_risk_consent,public_upload_consent,github_enabled_at,version,updated_at
                FROM automation_profiles WHERE user_id=:user FOR UPDATE
                """, new MapSqlParameterSource("user", userId), (rs, index) -> map(rs))
                .stream().findFirst().orElseGet(() -> {
                    db.update("INSERT INTO automation_profiles(user_id,updated_at) VALUES(:user,clock_timestamp())",
                            new MapSqlParameterSource("user", userId));
                    return locked(userId);
                });
    }

    private Profile map(java.sql.ResultSet rs) throws java.sql.SQLException {
        String targetJson = rs.getString("target");
        return new Profile(rs.getObject("user_id", UUID.class), rs.getString("device_id"),
                rs.getLong("generation"), rs.getBoolean("source_transfer_enabled"),
                rs.getBoolean("github_auto_commit_enabled"), rs.getString("ownership_mode"),
                rs.getLong("target_generation"), decode(targetJson), rs.getBoolean("automatic_transfer_consent"),
                rs.getBoolean("visibility_risk_consent"), rs.getBoolean("public_upload_consent"),
                instant(rs, "github_enabled_at"), rs.getLong("version"), instant(rs, "updated_at"));
    }

    private Instant instant(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        java.sql.Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private String encode(GitHubAutoCommitStore.Target target) {
        try { return target == null ? null : json.writeValueAsString(target); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    private GitHubAutoCommitStore.Target decode(String value) {
        if (value == null) return null;
        try { return json.readValue(value, GitHubAutoCommitStore.Target.class); }
        catch (Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    public record Profile(UUID userId, String deviceId, long generation,
            boolean sourceTransferEnabled, boolean githubAutoCommitEnabled, String ownershipMode,
            long targetGeneration, GitHubAutoCommitStore.Target target,
            boolean automaticTransferConsent, boolean visibilityRiskConsent, boolean publicUploadConsent,
            Instant githubEnabledAt, long version, Instant updatedAt) {
        static Profile off(UUID userId) {
            return new Profile(userId, null, 0, false, false, "PAGE_OWNED", 0, null,
                    false, false, false, null, 0, Instant.EPOCH);
        }
    }
}
