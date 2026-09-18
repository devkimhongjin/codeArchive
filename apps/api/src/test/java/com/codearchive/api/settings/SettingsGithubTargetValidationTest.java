package com.codearchive.api.settings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import com.codearchive.api.relay.RelayGrantService;
import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

class SettingsGithubTargetValidationTest {
  @Test
  void validatesTargetWithAuthenticatedImmutableGithubId() throws Exception {
    UserRepository users = mock(UserRepository.class);
    UserSettingsRepository settings = mock(UserSettingsRepository.class);
    RelayGrantService grants = mock(RelayGrantService.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "changed-login", "Name", null);
    setId(user, 77L);
    UserSettings current = new UserSettings(user);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(settings.findByUserId(77L)).thenReturn(Optional.of(current));
    when(provider.repositoriesPage("123", 44L, 1)).thenReturn(new GithubAppProvider.PageResult<>(List.of(
        new GithubAppProvider.RepositoryChoice(7L, "owner", "repo", "owner/repo", true, "release/v1")), false));
    doNothing().when(provider).validateTarget(eq("123"), eq(44L), eq(7L), eq("release/v1"), eq("src"));

    SettingsController controller = new SettingsController(users, settings, grants, provider, "1", "key", "app");
    var response = controller.put(github("123", "CHANGED-LOGIN"), "123", request());

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    verify(provider).repositoriesPage("123", 44L, 1);
    verify(provider).validateTarget("123", 44L, 7L, "release/v1", "src");
  }

  @Test
  void rejectsForeignExpectedGithubIdBeforeSettingsOrTargetValidation() throws Exception {
    UserRepository users = mock(UserRepository.class);
    UserSettingsRepository settings = mock(UserSettingsRepository.class);
    RelayGrantService grants = mock(RelayGrantService.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    setId(user, 77L);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));

    SettingsController controller = new SettingsController(users, settings, grants, provider, "1", "key", "app");
    var response = controller.put(github("123", "account"), "456", request());

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(settings, grants, provider);
  }

  @Test
  void rejectsGitPathWithoutSubmissionIdentityTokenBeforeTargetValidation() throws Exception {
    UserRepository users = mock(UserRepository.class);
    UserSettingsRepository settings = mock(UserSettingsRepository.class);
    RelayGrantService grants = mock(RelayGrantService.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    setId(user, 77L);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(settings.findByUserId(77L)).thenReturn(Optional.of(new UserSettings(user)));
    SettingsController controller = new SettingsController(users, settings, grants, provider, "1", "key", "app");
    SettingsRequest invalid = new SettingsRequest(0, "Name", "nick", false, false, "{number}", "archive/{number}", "Add {platform} {number} solution",
        "github-light", "github-dark", false, false, null, null, null, null, null);

    var response = controller.put(github("123", "account"), "123", invalid);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(response.getBody()).extracting("message").asString().contains("{capture_ID}").contains("{time}");
    verifyNoInteractions(provider);
  }

  private static SettingsRequest request() {
    return new SettingsRequest(0, "Name", "nick", false, false, "{number}", "archive/{number}/{capture_ID}", "Add {platform} {number} solution",
        "github-light", "github-dark", false, false, 44L, "owner", "repo", "release/v1", "src");
  }

  private static OAuth2AuthenticationToken github(String id, String login) {
    var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
        Map.of("id", id, "login", login), "id");
    return new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
  }

  private static void setId(AppUser user, Long id) throws Exception {
    Field field = AppUser.class.getDeclaredField("id");
    field.setAccessible(true);
    field.set(user, id);
  }
}
