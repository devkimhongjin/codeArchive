package com.codearchive.api.support;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.codearchive.api.auth.*;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.PlatformTransactionManager;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class SupportIntegrationTest {
  @Autowired MockMvc mvc; @Autowired UserRepository users; @Autowired SupportInquiryRepository inquiries; @Autowired SupportMessageRepository messages; @Autowired SupportService support; @Autowired PlatformTransactionManager transactions; @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @BeforeEach void clear() { cleanup(); }
  @AfterEach void cleanup() { messages.deleteAll(); inquiries.deleteAll(); users.deleteAll(); }
  @Test void requiresGithubSessionCsrfAndMatchingAccount() throws Exception {
    mvc.perform(get("/api/support/tickets")).andExpect(status().isUnauthorized());
    account("100");
    mvc.perform(post("/api/support/tickets").with(login("100", "ordinary")).header("X-CodeArchive-Github-Id", "100").contentType(MediaType.APPLICATION_JSON).content(ticket())).andExpect(status().isForbidden());
    mvc.perform(post("/api/support/tickets").with(login("100", "ordinary")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "999").contentType(MediaType.APPLICATION_JSON).content(ticket())).andExpect(status().isConflict());
    mvc.perform(post("/api/support/tickets").with(login("100", "ordinary")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "100").contentType(MediaType.APPLICATION_JSON).content(ticket())).andExpect(status().isOk()).andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store"))).andExpect(jsonPath("$.messages[0].body").value("<script>x</script>"));
  }
  @Test void ownerOtherAndImmutableAdminMatrix() throws Exception {
    account("101"); account("202"); account(SupportAdminPolicy.ADMIN_GITHUB_ID);
    long id = create("101");
    mvc.perform(get("/api/support/tickets/{id}", id).with(login("202", "other")).header("X-CodeArchive-Github-Id", "202")).andExpect(status().isNotFound());
    mvc.perform(get("/api/support/admin/tickets").with(login("202", "devkimhongjin")).header("X-CodeArchive-Github-Id", "202")).andExpect(status().isForbidden());
    mvc.perform(get("/api/support/admin/tickets").with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "different-login")).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID)).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].title").value("title"));
    mvc.perform(post("/api/support/admin/tickets/{id}/messages", id).with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "different-login")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"answer\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.inquiry.status").value("ANSWERED")).andExpect(jsonPath("$.messages[1].authorRole").value("ADMIN"));
  }
  @Test void retiredOwnerActionsNeverChangeOrDeleteAnInquiry() throws Exception {
    account("303"); long id = create("303");
    for (String action : List.of("messages", "close")) {
      mvc.perform(post("/api/support/tickets/{id}/" + action, id).with(login("303", "owner")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "303").contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"follow up\"}")).andExpect(status().isGone());
    }
    mvc.perform(delete("/api/support/tickets/{id}", id).with(login("303", "owner")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "303")).andExpect(status().isGone());
    Assertions.assertEquals(1, inquiries.count()); Assertions.assertEquals(1, messages.count());
    Assertions.assertEquals(SupportStatus.OPEN, inquiries.findById(id).orElseThrow().getStatus());
  }
  @Test void accessIsRateLimitedAndPagingIsBounded() throws Exception {
    account("909");
    for (int i = 0; i < 60; i++) mvc.perform(get("/api/support/access").with(login("909", "owner")).header("X-CodeArchive-Github-Id", "909")).andExpect(status().isOk());
    mvc.perform(get("/api/support/access").with(login("909", "owner")).header("X-CodeArchive-Github-Id", "909")).andExpect(status().isTooManyRequests());
    account("910");
    mvc.perform(get("/api/support/tickets").param("page", "-1").with(login("910", "owner")).header("X-CodeArchive-Github-Id", "910")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/support/tickets").param("page", "1001").with(login("910", "owner")).header("X-CodeArchive-Github-Id", "910")).andExpect(status().isBadRequest());
  }
  @Test void oldClosedInquirySurvivesEveryReadAndNeverExpires() throws Exception {
    account("1000"); account(SupportAdminPolicy.ADMIN_GITHUB_ID); long id = create("1000");
    jdbc.update("update support_inquiries set status='CLOSED', closed_at=? where id=?", Instant.now().minusSeconds(365L * 86400), id);
    mvc.perform(get("/api/support/access").with(login("1000", "owner")).header("X-CodeArchive-Github-Id", "1000")).andExpect(status().isOk()).andExpect(jsonPath("$.closedRetentionDays").doesNotExist());
    mvc.perform(get("/api/support/tickets").with(login("1000", "owner")).header("X-CodeArchive-Github-Id", "1000")).andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1));
    mvc.perform(get("/api/support/admin/tickets/{id}", id).with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "admin")).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID)).andExpect(status().isOk()).andExpect(jsonPath("$.messages[0].body").value("<script>x</script>"));
    Assertions.assertEquals(1, inquiries.count()); Assertions.assertEquals(1, messages.count());
    Assertions.assertEquals(SupportStatus.CLOSED, inquiries.findById(id).orElseThrow().getStatus());
  }
  @Test void administratorUsesReviewStateAndMaintainsOneAnswer() throws Exception {
    account("1200"); AppUser admin = account(SupportAdminPolicy.ADMIN_GITHUB_ID); long id = create("1200");
    mvc.perform(put("/api/support/admin/tickets/{id}/status", id).with(login("1200", "devkimhongjin")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", "1200").contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"IN_REVIEW\"}")).andExpect(status().isForbidden());
    mvc.perform(put("/api/support/admin/tickets/{id}/status", id).with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "admin")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"IN_REVIEW\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.inquiry.status").value("IN_REVIEW"));
    support.answer(admin, id, "first answer"); support.answer(admin, id, "updated answer");
    Assertions.assertEquals(2, messages.findByInquiryIdOrderByIdAsc(id).size());
    mvc.perform(get("/api/support/tickets/{id}", id).with(login("1200", "owner")).header("X-CodeArchive-Github-Id", "1200")).andExpect(status().isOk()).andExpect(jsonPath("$.inquiry.status").value("ANSWERED")).andExpect(jsonPath("$.messages[1].body").value("updated answer"));
    support.changeStatus(id, SupportStatus.IN_REVIEW);
    Assertions.assertEquals(2, messages.findByInquiryIdOrderByIdAsc(id).size());
  }
  @Test void administratorCannotCloseOrMarkUnansweredTicketAnswered() throws Exception {
    account("2000"); account(SupportAdminPolicy.ADMIN_GITHUB_ID); long id = create("2000");
    for (String state : List.of("CLOSED", "ANSWERED", "INVALID")) {
      mvc.perform(put("/api/support/admin/tickets/{id}/status", id).with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "admin")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"" + state + "\"}")).andExpect(status().isBadRequest());
    }
    mvc.perform(post("/api/support/admin/tickets/{id}/messages", id).with(login(SupportAdminPolicy.ADMIN_GITHUB_ID, "admin")).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", SupportAdminPolicy.ADMIN_GITHUB_ID).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"answer\",\"close\":true}")).andExpect(status().isBadRequest());
    Assertions.assertEquals(SupportStatus.OPEN, inquiries.findById(id).orElseThrow().getStatus());
    Assertions.assertEquals(1, messages.count());
  }
  private long create(String id) throws Exception { mvc.perform(post("/api/support/tickets").with(login(id, "user" + id)).with(csrf().asHeader()).header("X-CodeArchive-Github-Id", id).contentType(MediaType.APPLICATION_JSON).content(ticket())).andExpect(status().isOk()); return inquiries.findAll().stream().mapToLong(SupportInquiry::getId).max().orElseThrow(); }
  private static String ticket() { return "{\"category\":\"BUG\",\"title\":\"title\",\"body\":\"<script>x</script>\"}"; }
  private AppUser account(String id) { return users.saveAndFlush(AppUser.fromGithub(id, "user" + id, null, null)); }
  private RequestPostProcessor login(String id, String login) { var principal = new GithubOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), Map.of("id", id, "login", login), new GithubIdentity(id, login, null, null)); return oauth2Login().clientRegistration(ClientRegistration.withRegistrationId("github").clientId("test").clientSecret("test").clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri("http://localhost").authorizationUri("https://github.com/login/oauth/authorize").tokenUri("https://github.com/login/oauth/access_token").userInfoUri("https://api.github.com/user").userNameAttributeName("id").clientName("GitHub").build()).oauth2User(principal); }
}
