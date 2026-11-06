package com.codearchive.api.ai;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.codearchive.api.auth.*;
import com.codearchive.api.common.GithubAccountAssertion;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** With the default configuration no provider exists and the operator switch is off. */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class AiDisabledIntegrationTest {
  @Autowired MockMvc mvc; @Autowired UserRepository users;
  private AppUser account;
  @BeforeEach void create() { account = users.saveAndFlush(AppUser.fromGithub("710", "user710", null, null)); }
  @AfterEach void remove() { users.delete(account); }

  @Test void reportsDisabledAndRefusesReviewsBeforeTouchingAnySolution() throws Exception {
    mvc.perform(get("/api/ai/status").with(login()).header(GithubAccountAssertion.HEADER, "710"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false)).andExpect(jsonPath("$.provider").doesNotExist());
    mvc.perform(post("/api/ai/reviews/11111111-1111-4111-8111-111111111111").with(login()).with(csrf().asHeader()).header(GithubAccountAssertion.HEADER, "710"))
        .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.message").value("AI_DISABLED"));
  }

  private static RequestPostProcessor login() {
    var principal = new GithubOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), Map.of("id", "710", "login", "user710"), new GithubIdentity("710", "user710", null, null));
    return oauth2Login().clientRegistration(ClientRegistration.withRegistrationId("github").clientId("test").clientSecret("test").clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri("http://localhost").authorizationUri("https://github.com/login/oauth/authorize").tokenUri("https://github.com/login/oauth/access_token").userInfoUri("https://api.github.com/user").userNameAttributeName("id").clientName("GitHub").build()).oauth2User(principal);
  }
}
