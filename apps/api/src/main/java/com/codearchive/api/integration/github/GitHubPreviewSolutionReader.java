package com.codearchive.api.integration.github;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class GitHubPreviewSolutionReader {
    private final NamedParameterJdbcTemplate db;

    public GitHubPreviewSolutionReader(NamedParameterJdbcTemplate db) { this.db = db; }

    // Atomic source/provenance snapshot; do not hold a DB transaction across GitHub calls.
    public Optional<Snapshot> find(UUID ownerId, UUID solutionId) {
        return find(ownerId, solutionId, false);
    }

    Optional<Snapshot> findLocked(UUID ownerId, UUID solutionId) {
        return find(ownerId, solutionId, true);
    }

    private Optional<Snapshot> find(UUID ownerId, UUID solutionId, boolean lock) {
        return db.query("""
                SELECT id, platform, problem_number, language, code, result, accepted_capture, updated_at
                FROM solutions WHERE id = :id AND user_id = :owner
                """ + (lock ? " FOR SHARE" : ""), new MapSqlParameterSource("id", solutionId).addValue("owner", ownerId),
                (row, index) -> new Snapshot(row.getObject("id", UUID.class), row.getString("platform"),
                        row.getString("problem_number"), row.getString("language"), row.getString("code"),
                        row.getString("result"), row.getBoolean("accepted_capture"),
                        row.getTimestamp("updated_at").toInstant())).stream().findFirst();
    }

    public record Snapshot(UUID id, String platform, String problemNumber, String language, String code,
            String result, boolean acceptedCapture, Instant updatedAt) {
        @Override public String toString() { return "PreviewSolutionSnapshot[redacted]"; }
    }
}
