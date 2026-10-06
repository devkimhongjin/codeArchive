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

    @BeforeEach void clear() {
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
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items[0].sourceCode").doesNotExist())
                .andExpect(jsonPath("$.items[0].author.name", is("CodeArchive 사용자")))
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
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(0)));

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
                .andExpect(status().isOk()).andExpect(jsonPath("$.total", is(2)))
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
