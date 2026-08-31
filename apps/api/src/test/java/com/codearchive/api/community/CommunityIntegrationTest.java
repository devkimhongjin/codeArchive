package com.codearchive.api.community;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.*;
import com.codearchive.api.auth.session.*;
import com.codearchive.api.auth.user.*;
import com.codearchive.api.solution.*;

@SpringBootTest(properties = {"DB_PASSWORD=test-only", "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"})
@AutoConfigureMockMvc
@Testcontainers
class CommunityIntegrationTest {
    @Container @ServiceConnection static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired AuthSessionRepository sessions;
    @Autowired SecureTokenCodec tokens;
    @Autowired SolutionRepository solutions;
    @Autowired JdbcTemplate db;
    @Autowired CommunityService community;
    record Actor(UUID id, UUID session, String token) {}
    @AfterEach void clean() { db.update("DELETE FROM users"); }

    @Test void privateDefaultsProvenanceAndOwnerConsent() throws Exception {
        Actor a = actor(), b = actor();
        UUID manual = create(a, "1000", false), capture = create(a, "1000", true);
        request(a, get("/api/v1/community/sharing/{id}", capture)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.publicSolution").value(false)).andExpect(jsonPath("$.data.canPublish").value(true))
                .andExpect(jsonPath("$.data.eligible").value(false)).andExpect(header().string("Cache-Control", "no-store, private"));
        request(a, publish(manual, true)).andExpect(status().isForbidden());
        request(b, publish(capture, true)).andExpect(status().isNotFound());
        request(a, publish(capture, true)).andExpect(status().isOk()).andExpect(jsonPath("$.data.eligible").value(true));
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE id = ?", Boolean.class, manual)).isFalse();
    }

    @Test void identicalBulkRetryProvesLegacyCaptureWithoutOverwritingEditsOrPublishing() throws Exception {
        Actor a = actor(); UUID id = create(a, "1000", false);
        var original = solutions.findById(id).orElseThrow();
        Map<String, Object> payload = payload(original.getClientRecordId(), "1000");
        request(a, post("/api/v1/solutions/bulk-upsert").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("records", List.of(payload))))).andExpect(status().isOk());
        request(a, get("/api/v1/community/sharing/{id}", id)).andExpect(jsonPath("$.data.canPublish").value(true))
                .andExpect(jsonPath("$.data.publicSolution").value(false));
        payload.put("code", "different captured code");
        db.update("UPDATE solutions SET code = 'edited' WHERE id = ?", id);
        request(a, post("/api/v1/solutions/bulk-upsert").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("records", List.of(payload))))).andExpect(status().isOk());
        request(a, get("/api/v1/community/sharing/{id}", id)).andExpect(jsonPath("$.data.canPublish").value(false));
        assertThat(solutions.findById(id).orElseThrow().getCode()).isEqualTo("edited");
    }

    @Test void allRoutesHideExistenceUntilSameProblemAcceptedPublic() throws Exception {
        Actor a = actor(), b = actor();
        UUID peer = shared(b, "1000"), own = create(a, "1000", true);
        for (String suffix : List.of("", "/comments")) {
            mvc.perform(get("/api/v1/community/solutions/" + peer + suffix)).andExpect(status().isUnauthorized());
            request(a, get("/api/v1/community/solutions/" + peer + suffix)).andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.data").isEmpty());
        }
        request(a, get("/api/v1/community/peers/{id}", own)).andExpect(status().isNotFound());
        request(a, post("/api/v1/community/solutions/{id}/like", peer).contentType(MediaType.APPLICATION_JSON).content("{\"liked\":true}")).andExpect(status().isNotFound());
        request(a, post("/api/v1/community/solutions/{id}/comments", peer).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"hidden\"}")).andExpect(status().isNotFound());
        shared(a, "2000");
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isNotFound());
        request(a, publish(own, true)).andExpect(status().isOk());
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isOk()).andExpect(jsonPath("$.data.code").value("class Main {}"));
        request(a, get("/api/v1/community/peers/{id}", own)).andExpect(status().isOk()).andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.items[0].id").value(peer.toString())).andExpect(jsonPath("$.data.items[0].code").isEmpty());
    }

    @Test void platformIsolationAndRejectedCapture() throws Exception {
        Actor a = actor(), b = actor(); UUID peer = shared(b, "1000"), own = shared(a, "1000");
        db.update("UPDATE solutions SET platform = 'PROGRAMMERS' WHERE id = ?", own);
        db.update("UPDATE solutions SET accepted_capture = TRUE, community_public = TRUE, published_at = now() WHERE id = ?", own);
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isNotFound());
        db.update("UPDATE solutions SET result = 'WRONG_ANSWER' WHERE id = ?", own);
        request(a, publish(own, true)).andExpect(status().isForbidden());
    }

    @Test void lastQualifyingRevokeDeleteAndTargetRevokeApplyToEveryRead() throws Exception {
        Actor a = actor(), b = actor(); UUID peer = shared(b, "1000"), first = shared(a, "1000"), second = shared(a, "1000");
        request(a, publish(first, false)).andExpect(status().isOk()).andExpect(jsonPath("$.data.eligible").value(true));
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isOk());
        request(a, delete("/api/v1/solutions/{id}", second)).andExpect(status().isOk());
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isNotFound());
        request(a, get("/api/v1/community/solutions/{id}/comments", peer)).andExpect(status().isNotFound());
        request(a, publish(first, true)).andExpect(status().isOk());
        request(b, publish(peer, false)).andExpect(status().isOk());
        request(a, get("/api/v1/community/peers/{id}", first)).andExpect(jsonPath("$.data.items").isEmpty());
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(status().isNotFound());
    }

    @Test void editingCodeInvalidatesProofButMetadataEditDoesNot() throws Exception {
        Actor a = actor(); UUID own = shared(a, "1000"); var record = solutions.findById(own).orElseThrow();
        var payload = payload(record.getClientRecordId(), "1000"); payload.put("title", "Renamed");
        request(a, put("/api/v1/solutions/by-client-id/{id}", record.getClientRecordId()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(payload))).andExpect(status().isOk());
        request(a, get("/api/v1/community/sharing/{id}", own)).andExpect(jsonPath("$.data.publicSolution").value(true));
        payload.put("code", "edited solution");
        request(a, put("/api/v1/solutions/by-client-id/{id}", record.getClientRecordId()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(payload))).andExpect(status().isOk());
        request(a, get("/api/v1/community/sharing/{id}", own)).andExpect(jsonPath("$.data.publicSolution").value(false))
                .andExpect(jsonPath("$.data.canPublish").value(false));
    }

    @Test void commentCrudOwnerChecksValidationAndCascade() throws Exception {
        Actor a = actor(), b = actor(); UUID peer = shared(b, "1000"); shared(a, "1000");
        String text = "<script>alert('xss')</script>";
        String created = request(a, post("/api/v1/community/solutions/{id}/comments", peer).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("body", text)))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        UUID comment = UUID.fromString(json.readTree(created).path("data").path("id").asText());
        request(b, post("/api/v1/community/solutions/{id}/comments/{comment}", peer, comment).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"stolen\"}")).andExpect(status().isNotFound());
        request(b, delete("/api/v1/community/solutions/{id}/comments/{comment}", peer, comment)).andExpect(status().isNotFound());
        request(a, get("/api/v1/community/solutions/{id}/comments", peer)).andExpect(jsonPath("$.data.items[0].body").value(text));
        request(a, post("/api/v1/community/solutions/{id}/comments/{comment}", peer, comment).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"updated\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.body").value("updated"));
        for (String body : List.of("   ", "x".repeat(2001))) request(a, post("/api/v1/community/solutions/{id}/comments", peer)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("body", body)))).andExpect(status().isBadRequest());
        request(a, delete("/api/v1/community/solutions/{id}/comments/{comment}", peer, comment)).andExpect(status().isOk());
        community.addComment(principal(a), peer, "cascade"); community.like(principal(a), peer, true); community.report(principal(a), peer, "SPAM");
        request(b, delete("/api/v1/solutions/{id}", peer)).andExpect(status().isOk());
        for (String table : List.of("community_comments", "community_likes", "community_reports"))
            assertThat(db.queryForObject("SELECT count(*) FROM " + table, Integer.class)).isZero();
    }

    @Test void concurrentLikesAreIdempotentAndUnlikeIsRepeatable() throws Exception {
        Actor a = actor(), b = actor(); UUID peer = shared(b, "1000"); shared(a, "1000");
        try (var pool = Executors.newFixedThreadPool(4)) {
            var jobs = new ArrayList<Future<?>>();
            for (int i = 0; i < 8; i++) jobs.add(pool.submit(() -> community.like(principal(a), peer, true)));
            for (var job : jobs) job.get(10, TimeUnit.SECONDS);
        }
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(jsonPath("$.data.likeCount").value(1)).andExpect(jsonPath("$.data.liked").value(true));
        community.like(principal(a), peer, false); community.like(principal(a), peer, false);
        request(a, get("/api/v1/community/solutions/{id}", peer)).andExpect(jsonPath("$.data.likeCount").value(0));
    }

    @Test void csrfAndBoundedPaginationAndRateLimit() throws Exception {
        Actor a = actor(), b = actor(); UUID own = shared(a, "1000"), peer = shared(b, "1000");
        mvc.perform(publish(own, false).cookie(new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, a.token()))).andExpect(status().isForbidden());
        mvc.perform(publish(own, false).cookie(new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, a.token()))
                .header("Origin", "https://codearchive-dashboard-beta.onrender.com")).andExpect(status().isOk());
        request(a, publish(own, true)).andExpect(status().isOk());
        request(a, get("/api/v1/community/peers/{id}?offset=-1", own)).andExpect(status().isBadRequest());
        request(a, get("/api/v1/community/peers/{id}?offset=10001", own)).andExpect(status().isBadRequest());
        db.update("INSERT INTO community_rate_windows VALUES (?, 'comment', date_trunc('minute', now()), 30)", a.id());
        request(a, post("/api/v1/community/solutions/{id}/comments", peer).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"spam\"}")).andExpect(status().isTooManyRequests());
    }

    private CodeArchivePrincipal principal(Actor a) { return new CodeArchivePrincipal(a.id(), a.session(), "synthetic"); }
    private ResultActions request(Actor a, MockHttpServletRequestBuilder request) throws Exception { return mvc.perform(request.header("Authorization", "Bearer " + a.token())); }
    private MockHttpServletRequestBuilder publish(UUID id, boolean value) { return post("/api/v1/community/sharing/{id}", id).contentType(MediaType.APPLICATION_JSON).content("{\"publicSolution\":" + value + "}"); }
    private Actor actor() {
        Instant now = Instant.now();
        var user = users.save(CodeArchiveUser.create(new GitHubUserProfile(Math.abs(UUID.randomUUID().getMostSignificantBits()), "test-user", "Test", null), now));
        String token = UUID.randomUUID().toString();
        var session = sessions.save(AuthSession.create(user.getId(), tokens.hash(token), now.plusSeconds(3600), now));
        return new Actor(user.getId(), session.getId(), token);
    }
    private UUID shared(Actor a, String problem) throws Exception { UUID id = create(a, problem, true); request(a, publish(id, true)).andExpect(status().isOk()); return id; }
    private UUID create(Actor a, String problem, boolean captured) throws Exception {
        String client = UUID.randomUUID().toString(); var payload = payload(client, problem);
        if (captured) request(a, post("/api/v1/solutions/bulk-upsert").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("records", List.of(payload))))).andExpect(status().isOk());
        else request(a, put("/api/v1/solutions/by-client-id/{id}", client).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(payload))).andExpect(status().isOk());
        return solutions.findByUserIdAndClientRecordId(a.id(), client).orElseThrow().getId();
    }
    private Map<String, Object> payload(String client, String problem) {
        var p = new HashMap<String, Object>(); p.put("clientRecordId", client); p.put("platform", "SWEA"); p.put("problemNumber", problem);
        p.put("title", "Synthetic"); p.put("language", "Java"); p.put("code", "class Main {}"); p.put("result", "ACCEPTED");
        p.put("solvedAt", "2026-08-30T01:00:00Z"); p.put("observedAt", "2026-08-30T01:00:01Z"); p.put("aiUsage", "unknown"); return p;
    }
}
