package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

class GithubTargetControllerTest {
  @Test
  void usesImmutableGithubIdRatherThanMutableLoginForInstallationBrowse() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "renamed-login", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(provider.browseReady()).thenReturn(true);
    when(provider.installations("123")).thenReturn(List.of(new GithubAppProvider.InstallationChoice(44L, "Renamed-Login")));

    var response = new GithubTargetController(users, provider).installations(github("123", "RENAMED-LOGIN"), "123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    verify(provider).installations("123");
  }

  @Test
  void rejectsUnauthenticatedOrNonGithubPrincipalsBeforeProviderBrowse() {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);

    var response = new GithubTargetController(users, provider).installations(null, null);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void rejectsMissingOrForeignExpectedAccountBeforeProviderBrowse() {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider);

    assertThat(controller.installations(github("123", "account"), null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(controller.installations(github("123", "account"), "456").getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);
  }

  private static OAuth2AuthenticationToken github(String id, String login) {
    var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
        Map.of("id", id, "login", login), "id");
    return new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
  }
}
