package com.codearchive.api.community;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
@Transactional
public class CommunityService {
    private final NamedParameterJdbcTemplate db;
    public CommunityService(NamedParameterJdbcTemplate db) { this.db = db; }

    public record Sharing(boolean publicSolution, boolean canPublish, boolean eligible) {}
    public record Author(UUID id, String login) {}
    public record SharedSolution(UUID id, String platform, String problemNumber, String title,
            String language, String code, Instant publishedAt, Author author, long likeCount,
            long commentCount, boolean liked) {}
    public record Comment(UUID id, Author author, String body, Instant createdAt, Instant updatedAt) {}
    public record Page<T>(List<T> items, boolean hasMore) {}
    private record Target(UUID id, UUID owner, String platform, String problem, boolean shared, boolean captured) {}

    private static final String QUALIFIED = "community_public AND accepted_capture AND result = 'ACCEPTED'";
    private static final String SUMMARY = """
            SELECT s.id, s.platform, s.problem_number, s.title, s.language, s.published_at,
                   s.user_id, u.github_login,
                   (SELECT count(*) FROM community_likes l WHERE l.solution_id = s.id) AS likes,
                   (SELECT count(*) FROM community_comments c WHERE c.solution_id = s.id) AS comments,
                   EXISTS(SELECT 1 FROM community_likes l WHERE l.solution_id = s.id AND l.user_id = :user) AS liked
            """;

    public Sharing sharing(CodeArchivePrincipal principal, UUID id) {
        UUID user = user(principal);
        Target own = target(id, user, true, false);
        return new Sharing(own.shared(), own.captured(), qualify(user, own));
    }

    public Sharing publish(CodeArchivePrincipal principal, UUID id, boolean publish) {
        UUID user = user(principal);
        Target own = target(id, user, true, true);
        if (publish && !own.captured()) throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
        rate(user, "publish", 30);
        db.update("""
                UPDATE solutions SET community_public = :publish,
                    published_at = CASE WHEN :publish THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE NULL END
                WHERE id = :id AND user_id = :user
                """, params(user, id).addValue("publish", publish));
        return new Sharing(publish, own.captured(), qualify(user, own));
    }

    public Page<SharedSolution> peers(CodeArchivePrincipal principal, UUID anchor, String language, int offset) {
        UUID user = user(principal);
        Target own = target(anchor, user, true, false);
        if (!qualify(user, own)) throw unavailable();
        var p = problemParams(user, own).addValue("language", language).addValue("offset", offset);
        var rows = db.query(SUMMARY + """
                , NULL::text AS code FROM solutions s JOIN users u ON u.id = s.user_id
                WHERE s.platform = :platform AND s.problem_number = :problem
                  AND s.user_id <> :user AND s.community_public AND s.accepted_capture AND s.result = 'ACCEPTED'
                  AND (:language = '' OR s.language = :language)
                ORDER BY s.published_at DESC, s.id LIMIT 21 OFFSET :offset FOR SHARE OF s
                """, p, (rs, n) -> solution(rs));
        return page(rows, 20);
    }

    public SharedSolution detail(CodeArchivePrincipal principal, UUID id) {
        UUID user = user(principal);
        accessible(user, id);
        return db.queryForObject(SUMMARY + """
                , s.code FROM solutions s JOIN users u ON u.id = s.user_id WHERE s.id = :id
                """, params(user, id), (rs, n) -> solution(rs));
    }

    public Page<Comment> comments(CodeArchivePrincipal principal, UUID id, int offset) {
        UUID user = user(principal);
        accessible(user, id);
        return page(db.query("""
                SELECT c.*, u.github_login FROM community_comments c JOIN users u ON u.id = c.user_id
                WHERE c.solution_id = :id ORDER BY c.created_at, c.id LIMIT 51 OFFSET :offset
                """, params(user, id).addValue("offset", offset), (rs, n) -> comment(rs)), 50);
    }

    public Comment addComment(CodeArchivePrincipal principal, UUID id, String body) {
        UUID user = user(principal);
        accessible(user, id);
        rate(user, "comment", 30);
        UUID comment = UUID.randomUUID();
        db.update("INSERT INTO community_comments(id, solution_id, user_id, body) VALUES(:comment, :id, :user, :body)",
                params(user, id).addValue("comment", comment).addValue("body", body(body)));
        return readComment(user, id, comment);
    }

    public Comment editComment(CodeArchivePrincipal principal, UUID id, UUID comment, String body) {
        UUID user = user(principal);
        accessible(user, id);
        rate(user, "comment", 30);
        int changed = db.update("""
                UPDATE community_comments SET body = :body, updated_at = CURRENT_TIMESTAMP
                WHERE id = :comment AND solution_id = :id AND user_id = :user
                """, params(user, id).addValue("comment", comment).addValue("body", body(body)));
        if (changed != 1) throw unavailable();
        return readComment(user, id, comment);
    }

    public void deleteComment(CodeArchivePrincipal principal, UUID id, UUID comment) {
        UUID user = user(principal);
        accessible(user, id);
        if (db.update("DELETE FROM community_comments WHERE id = :comment AND solution_id = :id AND user_id = :user",
                params(user, id).addValue("comment", comment)) != 1) throw unavailable();
    }

    public void like(CodeArchivePrincipal principal, UUID id, boolean liked) {
        UUID user = user(principal);
        Target target = accessible(user, id);
        if (target.owner().equals(user)) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        rate(user, "like", 60);
        db.update(liked
                ? "INSERT INTO community_likes(solution_id, user_id) VALUES(:id, :user) ON CONFLICT DO NOTHING"
                : "DELETE FROM community_likes WHERE solution_id = :id AND user_id = :user", params(user, id));
    }

    public void report(CodeArchivePrincipal principal, UUID id, String reason) {
        UUID user = user(principal);
        accessible(user, id);
        if (!List.of("SPAM", "ABUSE", "SENSITIVE").contains(reason)) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        rate(user, "report", 5);
        db.update("""
                INSERT INTO community_reports(solution_id, user_id, reason) VALUES(:id, :user, :reason)
                ON CONFLICT(solution_id, user_id) DO UPDATE SET reason = EXCLUDED.reason
                """, params(user, id).addValue("reason", reason));
    }

    private Target accessible(UUID user, UUID id) {
        // The target and qualifying source rows remain SHARE-locked until commit.
        // A revoke/edit/delete waits, and later requests must qualify again.
        Target target = target(id, user, false, false);
        if (!target.shared() || !target.captured() || !qualify(user, target)) throw unavailable();
        return target;
    }

    private Target target(UUID id, UUID user, boolean ownerOnly, boolean write) {
        var rows = db.query("""
                SELECT id, user_id, platform, problem_number, community_public,
                       accepted_capture AND result = 'ACCEPTED' AS captured
                FROM solutions WHERE id = :id
                """ + (ownerOnly ? " AND user_id = :user" : "") + (write ? " FOR UPDATE" : " FOR SHARE"),
                params(user, id), (rs, n) -> new Target(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getString("platform"), rs.getString("problem_number"), rs.getBoolean("community_public"), rs.getBoolean("captured")));
        if (rows.isEmpty()) throw unavailable();
        return rows.getFirst();
    }

    private boolean qualify(UUID user, Target target) {
        return !db.query("SELECT id FROM solutions WHERE user_id = :user AND platform = :platform AND problem_number = :problem AND "
                + QUALIFIED + " ORDER BY id FOR SHARE", problemParams(user, target), (rs, n) -> rs.getObject(1)).isEmpty();
    }

    private void rate(UUID user, String action, int limit) {
        Integer attempts = db.queryForObject("""
                INSERT INTO community_rate_windows(user_id, action, window_start, attempts)
                VALUES(:user, :action, date_trunc('minute', CURRENT_TIMESTAMP), 1)
                ON CONFLICT(user_id, action) DO UPDATE SET
                    attempts = CASE WHEN community_rate_windows.window_start = EXCLUDED.window_start
                                    THEN community_rate_windows.attempts + 1 ELSE 1 END,
                    window_start = EXCLUDED.window_start RETURNING attempts
                """, new MapSqlParameterSource("user", user).addValue("action", action), Integer.class);
        if (attempts != null && attempts > limit) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
    }

    private Comment readComment(UUID user, UUID id, UUID comment) {
        return db.queryForObject("""
                SELECT c.*, u.github_login FROM community_comments c JOIN users u ON u.id = c.user_id
                WHERE c.id = :comment AND c.solution_id = :id AND c.user_id = :user
                """, params(user, id).addValue("comment", comment), (rs, n) -> comment(rs));
    }

    private static Comment comment(ResultSet rs) throws SQLException {
        return new Comment(rs.getObject("id", UUID.class), new Author(rs.getObject("user_id", UUID.class), rs.getString("github_login")),
                rs.getString("body"), rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }
    private static SharedSolution solution(ResultSet rs) throws SQLException {
        return new SharedSolution(rs.getObject("id", UUID.class), rs.getString("platform"), rs.getString("problem_number"),
                rs.getString("title"), rs.getString("language"), rs.getString("code"), rs.getTimestamp("published_at").toInstant(),
                new Author(rs.getObject("user_id", UUID.class), rs.getString("github_login")), rs.getLong("likes"), rs.getLong("comments"), rs.getBoolean("liked"));
    }
    private static String body(String body) {
        if (body == null || body.isBlank() || body.length() > 2000) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        return body.strip();
    }
    private static <T> Page<T> page(List<T> rows, int size) { return new Page<>(List.copyOf(rows.subList(0, Math.min(size, rows.size()))), rows.size() > size); }
    private static MapSqlParameterSource params(UUID user, UUID id) { return new MapSqlParameterSource("user", user).addValue("id", id); }
    private static MapSqlParameterSource problemParams(UUID user, Target target) { return params(user, target.id()).addValue("platform", target.platform()).addValue("problem", target.problem()); }
    private UUID user(CodeArchivePrincipal principal) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        // Serialize this user's concurrent community writes before acquiring solution locks.
        // This also prevents two simultaneous publications upgrading each other's SHARE lock.
        db.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))",
                new MapSqlParameterSource("key", principal.userId().toString()), (rs, n) -> 0);
        return principal.userId();
    }
    private static CodeArchiveException unavailable() { return new CodeArchiveException(ErrorCode.SOLUTION_NOT_FOUND); }
}
