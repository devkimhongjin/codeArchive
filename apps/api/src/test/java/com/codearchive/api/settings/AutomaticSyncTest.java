package com.codearchive.api.settings;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import com.codearchive.api.relay.RelayGrantService;
import com.codearchive.api.community.CommunityPublicationPolicy;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
class AutomaticSyncTest {
  @Test void extensionEnablesSyncAndLogoutRevokesConsent() {
    var settings = new UserSettings(); settings.enableAutomaticSync(); assertThat(settings.isAutoSyncEnabled()).isTrue();
    settings.revokeAutomationConsent(); assertThat(settings.isAutoSyncEnabled()).isFalse();
    settings.enableAutomaticSync(); assertThat(settings.isAutoSyncEnabled()).isTrue();
    assertThat(settings.isGithubAutoCommitEnabled()).isFalse();
  }
  @Test void enablesOnlySyncForAssertedAccountAndIsIdempotent() throws Exception {
    var users = mock(UserRepository.class); var repository = mock(UserSettingsRepository.class);
    var grants = mock(RelayGrantService.class); var provider = mock(GithubAppProvider.class); var publication = mock(CommunityPublicationPolicy.class);
    var user = AppUser.fromGithub("123", "account", "Name", null);
    var field = AppUser.class.getDeclaredField("id"); field.setAccessible(true); field.set(user, 77L);
    var settings = new UserSettings(user); settings.revokeAutomationConsent();
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(users.lockForCommunityLimit(77L)).thenReturn(Optional.of(user));
    when(repository.findByUserId(77L)).thenReturn(Optional.of(settings));
    var auth = new OAuth2AuthenticationToken(new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), Map.of("id", "123", "login", "account"), "id"), List.of(new SimpleGrantedAuthority("ROLE_USER")), "github");
    var controller = new SettingsController(publication, users, repository, grants, provider, "", "", "");
    assertThat(controller.enableAutomaticSync(auth, "456").getStatusCode().value()).isEqualTo(409);
    verifyNoInteractions(repository, grants, provider, publication);
    assertThat(controller.enableAutomaticSync(auth, "123").getStatusCode().value()).isEqualTo(200);
    assertThat(settings.isAutoSyncEnabled()).isTrue(); assertThat(settings.isGithubAutoCommitEnabled()).isFalse();
    assertThat(settings.getCommunityDuplicateVisibility()).isEqualTo("all");
    controller.enableAutomaticSync(auth, "123"); verify(repository, times(1)).saveAndFlush(settings); verify(grants, times(1)).revokeActiveForUser(77L);
    verifyNoInteractions(provider, publication);
  }
}
