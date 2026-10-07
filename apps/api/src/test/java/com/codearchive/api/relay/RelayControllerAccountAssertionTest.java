package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAutomationService;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.SolutionService;
import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

class RelayControllerAccountAssertionTest {
  private static final String DEVICE = "dashboardrelay0001";

  @Test
  void expectedGithubAccountIsRequiredBeforeGrantOrRevokeMutation() throws Exception {
    UserRepository users = mock(UserRepository.class);
    RelayGrantRepository grants = mock(RelayGrantRepository.class);
    RelayGrantService grantService = mock(RelayGrantService.class);
    UserSettingsRepository settings = mock(UserSettingsRepository.class);
    AppUser user = AppUser.fromGithub("200", "account-b", "B", null);
    setId(user, 20L);
    when(users.findByGithubId("200")).thenReturn(Optional.of(user));
    RelayController controller = new RelayController(users, grants, grantService,
        mock(SolutionService.class), mock(GithubAutomationService.class), settings);

    assertThat(controller.issue(github("200"), null, new RelayController.GrantRequest(DEVICE, 1)).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(controller.issue(github("200"), "100", new RelayController.GrantRequest(DEVICE, 1)).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(controller.revoke(github("200"), "100", DEVICE).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(grants, grantService, settings);
  }

  @Test
  void matchingGithubAccountMayRevokeOnlyItsOwnDevice() throws Exception {
    UserRepository users = mock(UserRepository.class);
    RelayGrantRepository grants = mock(RelayGrantRepository.class);
    RelayGrantService grantService = mock(RelayGrantService.class);
    AppUser user = AppUser.fromGithub("200", "account-b", "B", null);
    setId(user, 20L);
    when(users.findByGithubId("200")).thenReturn(Optional.of(user));
    RelayController controller = new RelayController(users, grants, grantService,
        mock(SolutionService.class), mock(GithubAutomationService.class), mock(UserSettingsRepository.class));

    assertThat(controller.revoke(github("200"), "200", DEVICE).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    verify(grantService).revokeActiveForUserDevice(20L, DEVICE);
  }

  private static OAuth2AuthenticationToken github(String id) {
    var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
        Map.of("id", id, "login", "account"), "id");
    return new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
  }

  private static void setId(AppUser user, Long id) throws Exception {
    Field field = AppUser.class.getDeclaredField("id");
    field.setAccessible(true);
    field.set(user, id);
  }
}
