package com.codearchive.api.ai;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.codearchive.api.auth.*;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.*;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest(properties = {"codearchive.ai.enabled=true", "codearchive.ai.provider=fake", "codearchive.ai.daily-limit=2", "codearchive.ai.max-source-bytes=200"})
@AutoConfigureMockMvc @ActiveProfiles("test")
class AiReviewIntegrationTest {
  @Autowired MockMvc mvc; @Autowired UserRepository users; @Autowired SolutionRepository solutions;
  @Autowired AiConsentRepository consents; @Autowired AiReviewRepository reviews; @Autowired AiDailyUsageRepository usage;
  // Other test classes share this database; remove only what this test created.
  private java.util.Set<Long> existingUsers = java.util.Set.of();
  @BeforeEach void remember() { existingUsers = users.findAll().stream().map(AppUser::getId).collect(java.util.stream.Collectors.toSet()); }
  @AfterEach void cleanup() {
    reviews.deleteAll(); consents.deleteAll(); usage.deleteAll();
    var created = users.findAll().stream().filter(user -> !existingUsers.contains(user.getId())).toList();
    for (AppUser user : created) solutions.deleteAll(solutions.findByUserIdOrderBySolvedAtDesc(user.getId()));
    users.deleteAll(created);
  }

  @Test void reviewRequiresConsentToTheCurrentNoticeAndIsCachedWithoutUsingTheDailyLimit() throws Exception {
    AppUser owner = account("700"); String capture = solution(owner, "class Main { public static void main(String[] a) {} }");
    get("700", "/api/ai/status").andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true)).andExpect(jsonPath("$.provider").value("fake"))
        .andExpect(jsonPath("$.consentGranted").value(false)).andExpect(jsonPath("$.dailyLimit").value(2)).andExpect(jsonPath("$.usedToday").value(0));
    post("700", "/api/ai/reviews/" + capture).andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("CONSENT_REQUIRED"));
    consent("700", "1999-01-01").andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("AI_NOTICE_CHANGED"));
    consent("700", AiReviewService.NOTICE_VERSION).andExpect(status().isOk()).andExpect(jsonPath("$.consentGranted").value(true));

    get("700", "/api/ai/reviews/" + capture).andExpect(status().isNoContent());
    post("700", "/api/ai/reviews/" + capture).andExpect(status().isOk()).andExpect(jsonPath("$.cached").value(false))
        .andExpect(jsonPath("$.provider").value("fake")).andExpect(jsonPath("$.promptVersion").value(AiPromptTemplate.VERSION))
        .andExpect(jsonPath("$.suggestions.length()").value(3));
    post("700", "/api/ai/reviews/" + capture).andExpect(status().isOk()).andExpect(jsonPath("$.cached").value(true));
    get("700", "/api/ai/reviews/" + capture).andExpect(status().isOk()).andExpect(jsonPath("$.cached").value(true));
    get("700", "/api/ai/status").andExpect(jsonPath("$.usedToday").value(1));
  }

  @Test void dailyLimitSizeLimitAndProviderFailuresAreDistinct() throws Exception {
    AppUser owner = account("701"); consent("701", AiReviewService.NOTICE_VERSION).andExpect(status().isOk());
    post("701", "/api/ai/reviews/" + solution(owner, "x".repeat(201))).andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.message").value("SOURCE_TOO_LARGE"));
    post("701", "/api/ai/reviews/" + solution(owner, "// " + FakeAiReviewProvider.TIMEOUT_MARKER)).andExpect(status().isGatewayTimeout()).andExpect(jsonPath("$.message").value("PROVIDER_TIMEOUT"));
    post("701", "/api/ai/reviews/" + solution(owner, "// " + FakeAiReviewProvider.BLOCK_MARKER)).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.message").value("SAFETY_BLOCKED"));
    // Both provider calls above used the daily limit of two, even though neither produced a review.
    post("701", "/api/ai/reviews/" + solution(owner, "int answer = 1;")).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.message").value("DAILY_LIMIT_REACHED"));
    get("701", "/api/ai/status").andExpect(jsonPath("$.usedToday").value(2));
  }

  @Test void anotherAccountsSolutionIsNotFoundAndWithdrawingConsentDeletesReviews() throws Exception {
    AppUser owner = account("702"); account("703"); String capture = solution(owner, "print(1)");
    consent("702", AiReviewService.NOTICE_VERSION); consent("703", AiReviewService.NOTICE_VERSION);
    post("703", "/api/ai/reviews/" + capture).andExpect(status().isNotFound()).andExpect(jsonPath("$.message").value("NOT_FOUND"));
    post("702", "/api/ai/reviews/" + capture).andExpect(status().isOk());
    mvc.perform(delete("/api/ai/consent").with(login("702")).with(csrf().asHeader()).header(GithubAccountAssertion.HEADER, "702"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.consentGranted").value(false));
    Assertions.assertEquals(0, reviews.count());
    post("702", "/api/ai/reviews/" + capture).andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("CONSENT_REQUIRED"));
  }

  @Test void requiresSessionCsrfAndMatchingAccount() throws Exception {
    account("704");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/ai/status")).andExpect(status().isUnauthorized());
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/ai/consent").with(login("704")).header(GithubAccountAssertion.HEADER, "704")
        .contentType(MediaType.APPLICATION_JSON).content("{\"noticeVersion\":\"" + AiReviewService.NOTICE_VERSION + "\"}")).andExpect(status().isForbidden());
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/ai/status").with(login("704")).header(GithubAccountAssertion.HEADER, "999")).andExpect(status().isConflict());
  }

  private ResultActions get(String id, String path) throws Exception {
    return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path).with(login(id)).header(GithubAccountAssertion.HEADER, id));
  }
  private ResultActions post(String id, String path) throws Exception {
    return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path).with(login(id)).with(csrf().asHeader()).header(GithubAccountAssertion.HEADER, id));
  }
  private ResultActions consent(String id, String version) throws Exception {
    return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/ai/consent").with(login(id)).with(csrf().asHeader()).header(GithubAccountAssertion.HEADER, id)
        .contentType(MediaType.APPLICATION_JSON).content("{\"noticeVersion\":\"" + version + "\"}"));
  }
  private String solution(AppUser owner, String source) {
    String capture = UUID.randomUUID().toString(); Instant now = Instant.now();
    solutions.saveAndFlush(new Solution(owner, capture, Platform.SWEA, "1234", "Title", "https://swexpertacademy.com/", "Java", source, "ACCEPTED", now, now, null, null));
    return capture;
  }
  private AppUser account(String id) { return users.saveAndFlush(AppUser.fromGithub(id, "user" + id, null, null)); }
  private static RequestPostProcessor login(String id) {
    var principal = new GithubOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), Map.of("id", id, "login", "user" + id), new GithubIdentity(id, "user" + id, null, null));
    return oauth2Login().clientRegistration(ClientRegistration.withRegistrationId("github").clientId("test").clientSecret("test").clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri("http://localhost").authorizationUri("https://github.com/login/oauth/authorize").tokenUri("https://github.com/login/oauth/access_token").userInfoUri("https://api.github.com/user").userNameAttributeName("id").clientName("GitHub").build()).oauth2User(principal);
  }
}
