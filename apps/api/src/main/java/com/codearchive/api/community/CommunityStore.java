package com.codearchive.api.community;

import com.codearchive.api.solution.Platform;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.stereotype.Repository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;

/** Every query repeats public-state and same-problem eligibility predicates. */
@Repository
public class CommunityStore {
    private final NamedParameterJdbcTemplate db;
    private final String schemaPrefix;
    public CommunityStore(NamedParameterJdbcTemplate db,
            @Value("${spring.jpa.properties.hibernate.default_schema:}") String schema) {
        this.db = db;
        if (!schema.isBlank() && !schema.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new IllegalArgumentException("Invalid community schema");
        this.schemaPrefix = schema.isBlank() ? "" : "\"" + schema + "\".";
    }
    private String qualified(String sql) {
        return sql.replaceAll("\\b(solutions|user_settings|community_likes|community_comments)\\b", schemaPrefix + "$1");
    }
    private <T> List<T> query(String sql, Map<String, ?> params, RowMapper<T> mapper) { return db.query(qualified(sql), params, mapper); }
    private <T> List<T> query(String sql, SqlParameterSource params, RowMapper<T> mapper) { return db.query(qualified(sql), params, mapper); }
    private Long count(String sql, Map<String, ?> params, Class<Long> type) { return db.queryForObject(qualified(sql), params, type); }
    private Long count(String sql, SqlParameterSource params, Class<Long> type) { return db.queryForObject(qualified(sql), params, type); }
    private int update(String sql, Map<String, ?> params) { return db.update(qualified(sql), params); }
    private int update(String sql, SqlParameterSource params) { return db.update(qualified(sql), params); }

    private static final String ELIGIBLE = """
        s.published_at is not null and s.result = 'ACCEPTED'
        and exists (select 1 from solutions own where own.user_id = :viewer
            and own.platform = s.platform and own.problem_number = s.problem_number
            and own.result = 'ACCEPTED' and own.published_at is not null)
        """;
    private static final String ACCESS = "select s.id from solutions s where s.id = :id and " + ELIGIBLE;
    public static final String MEMORY_BYTES = """
        case when s.memory_value >= 0 then case s.memory_unit
            when 'KB' then s.memory_value * 1000 when 'KiB' then s.memory_value * 1024
            when 'MB' then s.memory_value * 1000000 when 'MiB' then s.memory_value * 1048576
            else null end else null end
        """;
    private static final String NICKNAME = "coalesce(nullif(trim(p.nickname), ''), '닉네임 미설정')";
    private static final String STATS = """
        (select count(*) from community_likes l where l.solution_id = s.id) as like_count,
        (select count(*) from community_comments c where c.solution_id = s.id) as comment_count,
        exists (select 1 from community_likes l where l.solution_id = s.id and l.user_id = :viewer) as liked
        """;

    public static boolean validSort(String sort) {
        return List.of("submitted", "execution", "memory", "likes").contains(sort);
    }
    public CommunityService.SharedPage list(long viewer, Platform platform, String problem, String language,
                                            String sort, int page, int size) {
        var params = new MapSqlParameterSource().addValue("viewer", viewer).addValue("platform", platform.name())
            .addValue("problem", problem).addValue("language", language).addValue("limit", size).addValue("offset", page * size);
        String where = " where s.platform = :platform and s.problem_number = :problem and " + ELIGIBLE
            + (language == null ? "" : " and s.language_key = :language");
        String order = switch (sort) {
            case "likes" -> "(select count(*) from community_likes l where l.solution_id = s.id) desc, s.solved_at desc, s.id desc";
            case "execution" -> "case when s.execution_time >= 0 then s.execution_time else null end asc nulls last, s.solved_at desc, s.id desc";
            case "memory" -> MEMORY_BYTES + " asc nulls last, s.solved_at desc, s.id desc";
            default -> "s.solved_at desc, s.id desc";
        };
        long total = count("select count(*) from solutions s" + where, params, Long.class);
        var items = query("select s.id, s.user_id, s.platform, s.problem_number, s.title, s.language, s.language_key, "
            + "s.solved_at, s.published_at, s.execution_time, s.memory_value, s.memory_unit, octet_length(s.source_code) as code_length, "
            + NICKNAME + " as nickname, " + STATS + " from solutions s left join user_settings p on p.user_id = s.user_id"
            + where + " order by " + order + " limit :limit offset :offset", params, (rs, row) ->
                new CommunityService.SharedSummary(rs.getLong("id"), Platform.valueOf(rs.getString("platform")),
                    rs.getString("problem_number"), rs.getString("title"), rs.getString("language"), rs.getString("language_key"),
                    instant(rs, "solved_at"), instant(rs, "published_at"), rs.getBigDecimal("execution_time"),
                    rs.getBigDecimal("memory_value"), rs.getString("memory_unit"), rs.getInt("code_length"),
                    rs.getLong("user_id") == viewer, new CommunityService.PublicAuthor(rs.getString("nickname")),
                    rs.getLong("like_count"), rs.getLong("comment_count"), rs.getBoolean("liked")));
        // If the last qualifying share was revoked between count and rows, expose neither.
        requireEligibility(viewer, platform, problem);
        return new CommunityService.SharedPage(items, page, size, total, (long) (page + 1) * size < total);
    }
    public void requireEligibility(long viewer, Platform platform, String problem) {
        if (count("select count(*) from solutions where user_id = :viewer and platform = :platform"
            + " and problem_number = :problem and result = 'ACCEPTED' and published_at is not null",
            Map.of("viewer", viewer, "platform", platform.name(), "problem", problem), Long.class) == 0)
            throw new CommunityService.NotEligibleException();
    }
    public void requireAccess(long viewer, long id) {
        if (query(ACCESS, Map.of("viewer", viewer, "id", id), (rs, row) -> rs.getLong(1)).isEmpty())
            throw new NoSuchElementException();
    }
    public Stats stats(long viewer, long id) {
        return query("select " + STATS + " from solutions s where s.id = :id and " + ELIGIBLE,
            Map.of("viewer", viewer, "id", id), (rs, row) -> new Stats(rs.getLong("like_count"),
                rs.getLong("comment_count"), rs.getBoolean("liked"))).stream().findFirst().orElseThrow(NoSuchElementException::new);
    }
    public Stats like(long viewer, long id, boolean liked) {
        requireAccess(viewer, id);
        var params = Map.of("viewer", viewer, "id", id);
        if (liked) update("insert into community_likes(solution_id, user_id) select :id, :viewer where exists ("
            + ACCESS + ") and not exists (select 1 from community_likes where solution_id = :id and user_id = :viewer)", params);
        else update("delete from community_likes where solution_id = :id and user_id = :viewer and exists (" + ACCESS + ")", params);
        return stats(viewer, id);
    }
    public CommentPage comments(long viewer, long id, int page, int size) {
        requireAccess(viewer, id);
        var params = new MapSqlParameterSource().addValue("viewer", viewer).addValue("id", id)
            .addValue("limit", size).addValue("offset", page * size);
        String where = " where c.solution_id = :id and exists (" + ACCESS + ")";
        long total = count("select count(*) from community_comments c" + where, params, Long.class);
        var items = query("select c.*, " + NICKNAME + " as nickname from community_comments c"
            + " left join user_settings p on p.user_id = c.user_id" + where + " order by c.id desc limit :limit offset :offset",
            params, (rs, row) -> new Comment(rs.getLong("id"), rs.getString("body"), instant(rs, "created_at"),
                instant(rs, "updated_at"), new CommunityService.PublicAuthor(rs.getString("nickname")), rs.getLong("user_id") == viewer));
        requireAccess(viewer, id);
        return new CommentPage(items, page, size, total, (long) (page + 1) * size < total);
    }
    public void comment(long viewer, long id, Long commentId, String body, boolean delete) {
        requireAccess(viewer, id);
        var params = new MapSqlParameterSource().addValue("viewer", viewer).addValue("id", id)
            .addValue("comment", commentId).addValue("body", body).addValue("now", java.sql.Timestamp.from(Instant.now()));
        int changed;
        if (commentId == null) changed = update("insert into community_comments(solution_id, user_id, body, created_at, updated_at)"
            + " select :id, :viewer, :body, :now, :now where exists (" + ACCESS + ")", params);
        else if (delete) changed = update("delete from community_comments where id = :comment and solution_id = :id"
            + " and user_id = :viewer and exists (" + ACCESS + ")", params);
        else changed = update("update community_comments set body = :body, updated_at = :now where id = :comment"
            + " and solution_id = :id and user_id = :viewer and exists (" + ACCESS + ")", params);
        if (changed == 0) throw new NoSuchElementException();
        requireAccess(viewer, id);
    }
    private static Instant instant(ResultSet rs, String column) throws SQLException { return rs.getTimestamp(column).toInstant(); }
    public record Stats(long likeCount, long commentCount, boolean liked) {}
    public record Comment(long id, String body, Instant createdAt, Instant updatedAt, CommunityService.PublicAuthor author, boolean mine) {}
    public record CommentPage(List<Comment> items, int page, int size, long total, boolean hasMore) {}
}
