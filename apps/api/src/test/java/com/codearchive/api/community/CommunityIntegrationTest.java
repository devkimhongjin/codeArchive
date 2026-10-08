package com.codearchive.api.community;

import static org.hamcrest.Matchers.is;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.GithubIdentity;
import com.codearchive.api.auth.GithubOAuth2User;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CommunityIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired UserSettingsRepository settings;
    @Autowired SolutionRepository solutions;
    @Autowired com.codearchive.api.relay.RelayGrantRepository relayGrants;
    @Autowired com.codearchive.api.automation.GithubCommitJobRepository commitJobs;
    @Autowired CommunityRequestLimitRepository requestLimits;
    @Autowired CommunityRateLimiter rateLimiter;
    @Autowired com.codearchive.api.solution.SolutionService captureService;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper mapper;

    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @org.junit.jupiter.api.AfterEach void cleanInteractions() { jdbc.update("delete from community_comments"); jdbc.update("delete from community_likes"); }
    @BeforeEach void clear() {
        cleanInteractions();
        commitJobs.deleteAll();
        relayGrants.deleteAll();
        requestLimits.deleteAll();
        settings.deleteAll();
        solutions.deleteAll();
        users.deleteAll();
    }

    @Test void legacySolutionsStayPrivateAndOnlyOwnerCanPublishWithCsrf() throws Exception {
        AppUser alice = account("1001");
        Solution answer = solution(alice, Platform.SWEA, "1234", "JAVA", "class A {}");
        org.assertj.core.api.Assertions.assertThat(answer.getPublishedAt()).isNull();
        mvc.perform(get("/api/solutions").with(login("1001"))
                .header("X-CodeArchive-Account", "1001"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].visibility", is("private")));

        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("1001")).header("X-CodeArchive-Github-Id", "1001")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("2002")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "2002")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isUnauthorized());
        account("2002");
        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("2002")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "2002")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("1001")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "9999")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isConflict());
        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("1001")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "1001")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.visibility", is("published")));
        org.assertj.core.api.Assertions.assertThat(solutions.findById(answer.getId()).orElseThrow().getPublishedAt()).isNotNull();
        mvc.perform(get("/api/solutions").with(login("1001"))
                .header("X-CodeArchive-Account", "1001"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].visibility", is("published")));
    }

    @Test void sameProblemMutualShareFiltersLanguageAndRevocationImmediately() throws Exception {
        AppUser alice = account("1001");
        AppUser bob = account("2002");
        Solution aliceJava = solution(alice, Platform.SWEA, "1234", "JAVA", "class A {}");
        Solution aliceOther = solution(alice, Platform.SWEA, "9999", "Python", "print(1)");
        Solution bobOwn = solution(bob, Platform.SWEA, "1234", "Java", "class B {}");
        publish("1001", aliceJava);
        publish("1001", aliceOther);

        mvc.perform(get("/api/community/solutions").with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002")
                .param("platform", "SWEA").param("problemNumber", "1234"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/community/solutions/{id}", aliceJava.getId()).with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002"))
                .andExpect(status().isNotFound());

        publish("2002", bobOwn);
        mvc.perform(get("/api/community/solutions").with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002")
                .param("platform", "SWEA").param("problemNumber", "1234").param("languageKey", "java"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.items[0].sourceCode").doesNotExist())
                .andExpect(jsonPath("$.items[0].author.name").doesNotExist())
                .andExpect(jsonPath("$.items[0].author.nickname", is("닉네임 미설정")))
                .andExpect(jsonPath("$.items[0].author.githubId").doesNotExist());
        mvc.perform(get("/api/community/solutions/{id}", aliceJava.getId()).with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceCode", is("class A {}")));
        mvc.perform(get("/api/community/solutions").with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002")
                .param("platform", "SWEA").param("problemNumber", "1234").param("languageKey", "python"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(0)));
        mvc.perform(get("/api/community/solutions/{id}", aliceOther.getId()).with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002"))
                .andExpect(status().isNotFound());

        unpublish("1001", aliceJava);
        mvc.perform(get("/api/community/solutions/{id}", aliceJava.getId()).with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/community/solutions").with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002")
                .param("platform", "SWEA").param("problemNumber", "1234"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(1)));

        unpublish("2002", bobOwn);
        mvc.perform(get("/api/community/solutions").with(login("2002"))
                .header("X-CodeArchive-Github-Id", "2002")
                .param("platform", "SWEA").param("problemNumber", "1234"))
                .andExpect(status().isForbidden());
    }

    @Test void paginationAndInputBoundsDoNotExposeOtherProblems() throws Exception {
        AppUser alice = account("1001");
        AppUser bob = account("2002");
        AppUser carol = account("3003");
        publish("1001", solution(alice, Platform.PROGRAMMERS, "42", "JAVA", "A"));
        publish("2002", solution(bob, Platform.PROGRAMMERS, "42", "Python", "B"));
        publish("3003", solution(carol, Platform.PROGRAMMERS, "42", "Java", "C"));

        mvc.perform(get("/api/community/solutions").with(login("3003"))
                .header("X-CodeArchive-Github-Id", "3003")
                .param("platform", "PROGRAMMERS").param("problemNumber", "42")
                .param("page", "0").param("size", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(3)))
                .andExpect(jsonPath("$.hasMore", is(true))).andExpect(jsonPath("$.items.length()", is(1)));
        mvc.perform(get("/api/community/solutions").with(login("3003"))
                .header("X-CodeArchive-Github-Id", "3003")
                .param("platform", "PROGRAMMERS").param("problemNumber", "42")
                .param("size", "1000"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/community/solutions").with(login("3003"))
                .header("X-CodeArchive-Github-Id", "3003")
                .param("platform", "SWEA").param("problemNumber", "42"))
                .andExpect(status().isForbidden());
    }

    @Test void nonAcceptedLegacyRowsAndInvalidVisibilityCannotBePublished() throws Exception {
        AppUser owner = account("4004");
        Solution legacy = solutions.saveAndFlush(new Solution(owner, UUID.randomUUID().toString(),
                Platform.SWEA, "1234", "Legacy", "https://example.test/problem/1234", "Java",
                "source", "FAILED", Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"), null, null));
        mvc.perform(put("/api/community/solutions/{id}/visibility", legacy.getId())
                .with(login("4004")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "4004")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isConflict());
        mvc.perform(put("/api/community/solutions/{id}/visibility", legacy.getId())
                .with(login("4004")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "4004")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"PUBLIC\"}"))
                .andExpect(status().isBadRequest());
        org.assertj.core.api.Assertions.assertThat(solutions.findById(legacy.getId()).orElseThrow().getPublishedAt()).isNull();
    }

    @Test void accountQuotaPersistsAndRejectsTheEleventhWrite() throws Exception {
        AppUser owner = account("5005");
        Solution answer = solution(owner, Platform.SWEA, "1234", "Java", "class Main {}");
        for (int n = 0; n < 10; n++) org.junit.jupiter.api.Assertions.assertTrue(rateLimiter.allowWrite(owner.getId()));
        org.junit.jupiter.api.Assertions.assertFalse(rateLimiter.allowWrite(owner.getId()));
        org.assertj.core.api.Assertions.assertThat(requestLimits.findById(owner.getId())).isPresent();
        mvc.perform(put("/api/community/solutions/{id}/visibility", answer.getId())
                .with(login("5005")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "5005")
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isTooManyRequests());
        org.assertj.core.api.Assertions.assertThat(solutions.findById(answer.getId()).orElseThrow().getPublishedAt()).isNull();
    }

    @Autowired CommunityService community;

    @Test void summarySortsAcrossPageBoundariesNormalizesUnitsAndIncludesOwnWithoutIdentityLeak() throws Exception {
        AppUser alice = account("8001"), bob = account("8002");
        Solution own = measured(alice, "1", "한", "2026-01-03T00:00:00Z", "5", "2", "KB");
        Solution first = measured(bob, "1", "A", "2026-01-01T00:00:00Z", "1", "1", "KB");
        Solution second = measured(bob, "1", "B", "2026-01-02T00:00:00Z", "1", "1", "KiB");
        Solution missing = measured(bob, "1", "C", "2026-01-04T00:00:00Z", null, "1", "UNKNOWN");
        for (var item : java.util.List.of(own, first, second, missing)) { item.setPublished(true, Instant.now()); solutions.saveAndFlush(item); }
        var submitted = community.list(alice.getId(), Platform.SWEA, "1", null, "submitted", 0, 20);
        org.assertj.core.api.Assertions.assertThat(submitted.items()).extracting(CommunityService.SharedSummary::id)
            .containsExactly(missing.getId(), own.getId(), second.getId(), first.getId());
        var execution = community.list(alice.getId(), Platform.SWEA, "1", null, "execution", 0, 2);
        org.assertj.core.api.Assertions.assertThat(execution.items()).extracting(CommunityService.SharedSummary::id)
            .containsExactly(second.getId(), first.getId());
        org.assertj.core.api.Assertions.assertThat(execution.total()).isEqualTo(4);
        org.assertj.core.api.Assertions.assertThat(community.list(alice.getId(), Platform.SWEA, "1", null, "execution", 1, 2).items())
            .extracting(CommunityService.SharedSummary::id).containsExactly(own.getId(), missing.getId());
        var memory = community.list(alice.getId(), Platform.SWEA, "1", "java", "memory", 0, 20);
        org.assertj.core.api.Assertions.assertThat(memory.items()).extracting(CommunityService.SharedSummary::id)
            .containsExactly(first.getId(), second.getId(), own.getId(), missing.getId());
        org.assertj.core.api.Assertions.assertThat(memory.items().get(2).mine()).isTrue();
        org.assertj.core.api.Assertions.assertThat(memory.items().get(2).codeLength()).isEqualTo(3);
        mvc.perform(get("/api/community/solutions/{id}", own.getId()).with(login("8001"))
            .header("X-CodeArchive-Github-Id", "8001")).andExpect(status().isOk())
            .andExpect(jsonPath("$.mine", is(true))).andExpect(jsonPath("$.author.name").doesNotExist())
            .andExpect(jsonPath("$.author.githubLogin").doesNotExist());
        mvc.perform(get("/api/community/solutions").with(login("8001")).header("X-CodeArchive-Github-Id", "8001")
            .param("platform", "SWEA").param("problemNumber", "1").param("sort", "source_code"))
            .andExpect(status().isBadRequest());
    }

    @Test void likesAreIdempotentEvenForConcurrentRequestsAndRevocationHidesCounts() throws Exception {
        AppUser alice = account("8101"), bob = account("8102");
        Solution target = solution(alice, Platform.SWEA, "1", "Java", "A");
        Solution own = solution(bob, Platform.SWEA, "1", "Java", "B");
        publish("8101", target); publish("8102", own);
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var one = pool.submit(() -> community.like(bob.getId(), target.getId(), true));
            var two = pool.submit(() -> community.like(bob.getId(), target.getId(), true));
            org.assertj.core.api.Assertions.assertThat(one.get(10, java.util.concurrent.TimeUnit.SECONDS).likeCount()).isEqualTo(1);
            org.assertj.core.api.Assertions.assertThat(two.get(10, java.util.concurrent.TimeUnit.SECONDS).likeCount()).isEqualTo(1);
        } finally { pool.shutdownNow(); }
        org.assertj.core.api.Assertions.assertThat(community.list(bob.getId(), Platform.SWEA, "1", null, "likes", 0, 1).items().get(0).id())
            .isEqualTo(target.getId());
        mvc.perform(put("/api/community/solutions/{id}/like", target.getId()).with(login("8102"))
            .header("X-CodeArchive-Github-Id", "8102").contentType(MediaType.APPLICATION_JSON).content("{\"liked\":false}"))
            .andExpect(status().isForbidden());
        mvc.perform(put("/api/community/solutions/{id}/like", target.getId()).with(login("8102")).with(csrf().asHeader())
            .header("X-CodeArchive-Github-Id", "999").contentType(MediaType.APPLICATION_JSON).content("{\"liked\":false}"))
            .andExpect(status().isConflict());
        org.assertj.core.api.Assertions.assertThat(community.like(bob.getId(), target.getId(), false).likeCount()).isZero();
        org.assertj.core.api.Assertions.assertThat(community.like(bob.getId(), target.getId(), false).likeCount()).isZero();
        unpublish("8102", own);
        mvc.perform(get("/api/community/solutions/{id}/comments", target.getId()).with(login("8102"))
            .header("X-CodeArchive-Github-Id", "8102")).andExpect(status().isNotFound());
        mvc.perform(put("/api/community/solutions/{id}/like", target.getId()).with(login("8102")).with(csrf().asHeader())
            .header("X-CodeArchive-Github-Id", "8102").contentType(MediaType.APPLICATION_JSON).content("{\"liked\":true}"))
            .andExpect(status().isNotFound());
    }

    @Test void commentsAreBoundedPaginatedAndOnlyAuthorCanChangeWhilePublic() throws Exception {
        AppUser alice = account("8201"), bob = account("8202");
        Solution target = solution(alice, Platform.SWEA, "1", "Java", "A");
        Solution own = solution(bob, Platform.SWEA, "1", "Java", "B");
        publish("8201", target); publish("8202", own);
        mvc.perform(post("/api/community/solutions/{id}/comments", target.getId()).with(login("8202")).with(csrf().asHeader())
            .header("X-CodeArchive-Github-Id", "8202").contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"<script>alert(1)</script>\"}"))
            .andExpect(status().isOk());
        var comments = community.comments(bob.getId(), target.getId(), 0, 1);
        long comment = comments.items().get(0).id();
        org.assertj.core.api.Assertions.assertThat(comments.items().get(0).body()).isEqualTo("<script>alert(1)</script>");
        org.assertj.core.api.Assertions.assertThat(comments.items().get(0).mine()).isTrue();
        mvc.perform(put("/api/community/solutions/{id}/comments/{comment}", target.getId(), comment).with(login("8201")).with(csrf().asHeader())
            .header("X-CodeArchive-Github-Id", "8201").contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"tamper\"}"))
            .andExpect(status().isNotFound());
        community.comment(bob.getId(), target.getId(), comment, "edited", false);
        community.comment(bob.getId(), target.getId(), null, "second", false);
        org.assertj.core.api.Assertions.assertThat(community.comments(alice.getId(), target.getId(), 0, 1).hasMore()).isTrue();
        org.assertj.core.api.Assertions.assertThat(community.comments(alice.getId(), target.getId(), 1, 1).items().get(0).mine()).isFalse();
        mvc.perform(post("/api/community/solutions/{id}/comments", target.getId()).with(login("8202")).with(csrf().asHeader())
            .header("X-CodeArchive-Github-Id", "8202").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("body", "x".repeat(2001)))))
            .andExpect(status().isBadRequest());
        community.comment(bob.getId(), target.getId(), comment, null, true);
        org.assertj.core.api.Assertions.assertThat(community.comments(bob.getId(), target.getId(), 0, 20).total()).isEqualTo(1);
        unpublish("8201", target);
        mvc.perform(get("/api/community/solutions/{id}/comments", target.getId()).with(login("8202"))
            .header("X-CodeArchive-Github-Id", "8202")).andExpect(status().isNotFound());
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> community.comment(bob.getId(), target.getId(), null, "hidden", false))
            .isInstanceOf(java.util.NoSuchElementException.class);
    }

    @Test void duplicatePublicationSettingReconcilesExistingAndNewCapturesAndPreservesOlderClients() throws Exception {
        AppUser owner = account("8301"), other = account("8302");
        Solution slow = measured(owner, "1234", "x", "2026-01-03T00:00:00Z", "20", "1", "MiB");
        Solution fast = measured(owner, "1234", "longer", "2026-01-02T00:00:00Z", "5", "1", "MB");
        Solution unknown = measured(owner, "1234", "?", "2026-01-04T00:00:00Z", null, "1", "UNKNOWN");
        Solution otherPrivate = solution(other, Platform.SWEA, "1234", "Java", "private");
        policy("8301", "execution");
        org.assertj.core.api.Assertions.assertThat(solutions.findPublishedProblemsForOwner(owner.getId())).hasSize(1);
        org.assertj.core.api.Assertions.assertThat(solutions.findById(fast.getId()).orElseThrow().isPublished()).isTrue();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(slow.getId()).orElseThrow().isPublished()).isFalse();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(unknown.getId()).orElseThrow().isPublished()).isFalse();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(otherPrivate.getId()).orElseThrow().isPublished()).isFalse();
        var next = capture(false); next.setExecutionTime(new java.math.BigDecimal("1"));
        Solution newest = captureService.upsert("8301", next);
        org.assertj.core.api.Assertions.assertThat(newest.isPublished()).isTrue();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(fast.getId()).orElseThrow().isPublished()).isFalse();
        var older = setting("8301"); older.remove("communityDuplicateVisibility");
        saveSetting("8301", older).andExpect(status().isOk()).andExpect(jsonPath("$.communityDuplicateVisibility", is("execution")));
        policy("8301", "memory");
        org.assertj.core.api.Assertions.assertThat(solutions.findById(fast.getId()).orElseThrow().isPublished()).isTrue();
        policy("8301", "length");
        org.assertj.core.api.Assertions.assertThat(solutions.findById(unknown.getId()).orElseThrow().isPublished()).isTrue();
        policy("8301", "all");
        org.assertj.core.api.Assertions.assertThat(solutions.countByUserIdAndResultAndPublishedAtIsNotNull(owner.getId(), "ACCEPTED")).isEqualTo(4);
        var invalid = setting("8301"); invalid.put("communityDuplicateVisibility", "id");
        saveSetting("8301", invalid).andExpect(status().isBadRequest());
    }
    private void policy(String account, String policy) throws Exception {
        var request = setting(account); request.put("communityDuplicateVisibility", policy);
        saveSetting(account, request).andExpect(status().isOk()).andExpect(jsonPath("$.communityDuplicateVisibility", is(policy)));
    }
    private Solution measured(AppUser owner, String problem, String source, String time, String execution, String memory, String unit) {
        var solution = new Solution(owner, UUID.randomUUID().toString(), Platform.SWEA, problem, "Synthetic", "https://example.test/problem",
            "Java", source, "ACCEPTED", Instant.parse(time), Instant.parse(time), execution == null ? null : new java.math.BigDecimal(execution), null);
        solution.setMemoryMeasurement(memory == null ? null : new java.math.BigDecimal(memory), unit);
        return solutions.saveAndFlush(solution);
    }

    private AppUser account(String id) {
        return users.saveAndFlush(AppUser.fromGithub(id, "user" + id, "User " + id, null,
                "https://avatars.githubusercontent.com/u/" + id));
    }

    @Test void newAndHistoricalCapturesUsePublicDefaultButLegacyRowsStayPrivate() throws Exception {
        AppUser owner = account("6006");
        Solution legacy = solution(owner, Platform.SWEA, "legacy", "Java", "legacy");
        mvc.perform(get("/api/settings").with(login("6006")).header("X-CodeArchive-Github-Id", "6006"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.communityPublicByDefault", is(true)));
        var live = captureService.upsert("6006", capture(false));
        var historical = captureService.upsert("6006", capture(true));
        org.assertj.core.api.Assertions.assertThat(live.isPublished()).isTrue();
        org.assertj.core.api.Assertions.assertThat(historical.isPublished()).isTrue();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(legacy.getId()).orElseThrow().isPublished()).isFalse();
    }

    @Test void privatePreferenceIsAccountOwnedAndOmittedFieldAndRetriesPreservePrivacy() throws Exception {
        account("6007"); account("6008");
        var snapshot = setting("6007");
        snapshot.put("communityPublicByDefault", false);
        saveSetting("6007", snapshot).andExpect(status().isOk()).andExpect(jsonPath("$.communityPublicByDefault", is(false)));
        var payload = capture(false);
        var privateCapture = captureService.upsert("6007", payload);
        org.assertj.core.api.Assertions.assertThat(privateCapture.isPublished()).isFalse();
        org.assertj.core.api.Assertions.assertThat(captureService.upsert("6008", capture(false)).isPublished()).isTrue();
        var olderClient = setting("6007"); olderClient.remove("communityPublicByDefault");
        saveSetting("6007", olderClient).andExpect(status().isOk()).andExpect(jsonPath("$.communityPublicByDefault", is(false)));
        var publicPreference = setting("6007"); publicPreference.put("communityPublicByDefault", true);
        saveSetting("6007", publicPreference).andExpect(status().isOk());
        org.assertj.core.api.Assertions.assertThat(captureService.upsert("6007", payload).isPublished()).isFalse();
        var publicPayload = capture(true);
        var published = captureService.upsert("6007", publicPayload);
        unpublish("6007", published);
        org.assertj.core.api.Assertions.assertThat(captureService.upsert("6007", publicPayload).isPublished()).isFalse();
    }

    @Test void publishAllIsScopedAcceptedOnlyAndIdempotentWithProblemAndSubmissionCounts() throws Exception {
        AppUser owner = account("7007"), other = account("7008");
        Solution first = solution(owner, Platform.SWEA, "1234", "Java", "one");
        solution(owner, Platform.SWEA, "1234", "C++", "two");
        solution(owner, Platform.JUNGOL, "1234", "Java", "three");
        Solution existing = solution(owner, Platform.SWEA, "5678", "Java", "old");
        Instant originalTime = Instant.parse("2025-01-01T00:00:00Z"); existing.setPublished(true, originalTime); solutions.saveAndFlush(existing);
        Solution excluded = solutions.saveAndFlush(new Solution(owner, UUID.randomUUID().toString(), Platform.SWEA, "failed", "Failed", "https://example.test/problem", "Java", "failed", "FAILED", originalTime, originalTime, null, null));
        Solution otherPrivate = solution(other, Platform.SWEA, "1234", "Java", "other");
        publishAll("7007").andExpect(status().isOk()).andExpect(jsonPath("$.changedSubmissions", is(3)))
                .andExpect(jsonPath("$.publishedProblems", is(3))).andExpect(jsonPath("$.publishedSubmissions", is(4)));
        Instant firstTime = solutions.findById(first.getId()).orElseThrow().getPublishedAt();
        publishAll("7007").andExpect(status().isOk()).andExpect(jsonPath("$.changedSubmissions", is(0)));
        org.assertj.core.api.Assertions.assertThat(solutions.findById(first.getId()).orElseThrow().getPublishedAt()).isEqualTo(firstTime);
        org.assertj.core.api.Assertions.assertThat(solutions.findById(existing.getId()).orElseThrow().getPublishedAt()).isEqualTo(originalTime);
        org.assertj.core.api.Assertions.assertThat(solutions.findById(excluded.getId()).orElseThrow().isPublished()).isFalse();
        org.assertj.core.api.Assertions.assertThat(solutions.findById(otherPrivate.getId()).orElseThrow().isPublished()).isFalse();
    }

    @Test void publishAllRequiresAuthenticationAccountAssertionCsrfAndExplicitAction() throws Exception {
        AppUser owner = account("7010");
        Solution answer = solution(owner, Platform.SWEA, "1234", "Java", "source");
        mvc.perform(post("/api/community/solutions/publish-all").with(csrf().asHeader()).contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/community/solutions/publish-all").with(login("7010")).header("X-CodeArchive-Github-Id", "7010").contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/community/solutions/publish-all").with(login("7010")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "7011").contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/community/solutions/publish-all").with(login("7010")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "7010").contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"private\"}"))
                .andExpect(status().isBadRequest());
        org.assertj.core.api.Assertions.assertThat(solutions.findById(answer.getId()).orElseThrow().isPublished()).isFalse();
    }

    private org.springframework.test.web.servlet.ResultActions publishAll(String id) throws Exception {
        return mvc.perform(post("/api/community/solutions/publish-all").with(login(id)).with(csrf().asHeader())
                .header("X-CodeArchive-Github-Id", id).contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"published\"}"));
    }
    private com.fasterxml.jackson.databind.node.ObjectNode setting(String id) throws Exception {
        return (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(mvc.perform(get("/api/settings").with(login(id)).header("X-CodeArchive-Github-Id", id)).andReturn().getResponse().getContentAsString());
    }
    private org.springframework.test.web.servlet.ResultActions saveSetting(String id, com.fasterxml.jackson.databind.node.ObjectNode value) throws Exception {
        return mvc.perform(put("/api/settings").with(login(id)).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", id)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(value)));
    }
    private com.codearchive.api.solution.CapturePayload capture(boolean historical) {
        var payload = new com.codearchive.api.solution.CapturePayload();
        payload.setCaptureId(UUID.randomUUID().toString()); payload.setPlatform("SWEA"); payload.setProblemNumber("1234");
        payload.setTitle("Synthetic"); payload.setProblemUrl("https://example.test/problem/1234"); payload.setLanguage("Java");
        payload.setSourceCode("class Synthetic {}"); payload.setResult("ACCEPTED");
        payload.setObservedAt("2026-01-01T00:00:00Z"); payload.setSolvedAt("2026-01-01T00:00:00Z");
        if (historical) { payload.setHistoricalImport(true); payload.setHistoricalSubmissionId("AbCd1234"); }
        return payload;
    }

    private Solution solution(AppUser owner, Platform platform, String number, String language, String source) {
        return solutions.saveAndFlush(new Solution(owner, UUID.randomUUID().toString(), platform,
                number, "Problem " + number, "https://example.test/problem/" + number,
                language, source, "ACCEPTED", Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"), null, null));
    }

    private void publish(String id, Solution solution) throws Exception { visibility(id, solution, "published"); }
    private void unpublish(String id, Solution solution) throws Exception { visibility(id, solution, "private"); }
    private void visibility(String id, Solution solution, String value) throws Exception {
        mvc.perform(put("/api/community/solutions/{id}/visibility", solution.getId())
                .with(login(id)).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"" + value + "\"}"))
                .andExpect(status().isOk());
    }

    private RequestPostProcessor login(String id) {
        var authority = new SimpleGrantedAuthority("ROLE_USER");
        var attributes = Map.<String, Object>of("id", id, "login", "user" + id);
        var principal = new GithubOAuth2User(java.util.List.of(authority), attributes,
                new GithubIdentity(id, "user" + id, "User " + id, null));
        return oauth2Login().clientRegistration(ClientRegistration.withRegistrationId("github")
                .clientId("test-client").clientSecret("test-secret")
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("http://localhost:5173/api/login/oauth2/code/github")
                .authorizationUri("https://github.com/login/oauth/authorize")
                .tokenUri("https://github.com/login/oauth/access_token")
                .userInfoUri("https://api.github.com/user").userNameAttributeName("id")
                .clientName("GitHub").build()).oauth2User(principal);
    }
}
