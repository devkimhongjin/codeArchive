package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.settings.UserSettingsRepository;
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

    var response = new GithubTargetController(users, provider, mock(UserSettingsRepository.class)).installations(github("123", "RENAMED-LOGIN"), "123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    verify(provider).installations("123");
  }

  @Test
  void rejectsUnauthenticatedOrNonGithubPrincipalsBeforeProviderBrowse() {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);

    var response = new GithubTargetController(users, provider, mock(UserSettingsRepository.class)).installations(null, null);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void rejectsMissingOrForeignExpectedAccountBeforeProviderBrowse() {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));

    assertThat(controller.installations(github("123", "account"), null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(controller.installations(github("123", "account"), "456").getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);
  }

  @Test
  void readmeInitializationRequiresTheExpectedAuthenticatedAccount() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));

    assertThat(controller.initializeReadme(null, null, 44L, 7L).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.initializeReadme(github("123", "account"), "456", 44L, 7L).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verify(provider, never()).initializeReadme("123", 44L, 7L);

    when(provider.browseReady()).thenReturn(true);
    when(provider.initializeReadme("123", 44L, 7L)).thenReturn("primary");
    var response = controller.initializeReadme(github("123", "account"), "123", 44L, 7L);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).isEqualTo(Map.of("defaultBranch", "primary"));
  }

  @Test
  void treeBrowseRequiresTheExpectedAuthenticatedAccount() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));

    assertThat(controller.tree(null, null, 44L, 7L, "main", "", 1).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.tree(github("123", "account"), "456", 44L, 7L, "main", "", 1).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);

    when(provider.browseReady()).thenReturn(true);
    var tree = new GithubAppProvider.TreePage("", "a".repeat(40), List.of(), 1, false, false);
    when(provider.treePage("123", 44L, 7L, "main", "", 1)).thenReturn(tree);
    assertThat(controller.tree(github("123", "account"), "123", 44L, 7L, "main", "", 1).getBody())
        .isEqualTo(tree);
  }

  @Test
  void fileViewRequiresTheExpectedAccountAndKeepsProviderFailuresOpaque() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));

    assertThat(controller.file(null, null, 44L, 7L, "main", "README.md").getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.file(github("123", "account"), "456", 44L, 7L, "main", "README.md").getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);

    when(provider.browseReady()).thenReturn(true);
    var file = new GithubAppProvider.FileView("README.md", "a".repeat(40), "b".repeat(40), "100644", 7, "private", null);
    when(provider.fileView("123", 44L, 7L, "main", "README.md")).thenReturn(file);
    assertThat(controller.file(github("123", "account"), "123", 44L, 7L, "main", "README.md").getBody())
        .isEqualTo(file);
    when(provider.fileView("123", 44L, 7L, "main", "missing.txt"))
        .thenThrow(new GithubAppProvider.FileMissingException());
    assertThat(controller.file(github("123", "account"), "123", 44L, 7L, "main", "missing.txt").getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void fileAdditionRequiresTheExpectedAccountAndReportsConflictsWithoutSource() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));
    var request = new GithubTargetController.AddFileRequest("main", "new.txt", "secret source", "Add file", "a".repeat(40), false);

    assertThat(controller.addFile(null, null, 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.addFile(github("123", "account"), "456", 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);

    when(provider.browseReady()).thenReturn(true);
    when(provider.addFile("123", 44L, 7L, "main", "new.txt", "secret source", "Add file", "a".repeat(40), false))
        .thenThrow(new GithubAppProvider.TargetConflictException("path collision"));
    var response = controller.addFile(github("123", "account"), "123", 44L, 7L, request);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(response.getBody().toString()).doesNotContain("secret source");
  }

  @Test
  void fileEditRequiresTheExpectedAccountAndNeverEchoesSubmittedSource() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, savedTarget(user));
    var request = new GithubTargetController.EditFileRequest("main", "기존.java", "private source", "Edit file", "a".repeat(40), "b".repeat(40));
    assertThat(controller.editFile(null, null, 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.editFile(github("123", "account"), "456", 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);
    when(provider.browseReady()).thenReturn(true);
    when(provider.matchesRepository("123", 44L, 7L, "account", "algorithm")).thenReturn(true);
    when(provider.replaceFile("123", 44L, 7L, "main", "기존.java", "private source", "Edit file", "a".repeat(40), "b".repeat(40)))
        .thenThrow(new GithubAppProvider.TargetConflictException("file changed"));
    var response = controller.editFile(github("123", "account"), "123", 44L, 7L, request);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(response.getBody().toString()).doesNotContain("private source");
  }

  @Test
  void treeOperationPreviewRequiresTheExpectedAccountBeforeProviderAccess() {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    GithubTargetController controller = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));
    var request = new GithubTargetController.TreeOperationPreviewRequest("DELETE", "main", "old.txt", null, "Delete old.txt", "a".repeat(40));

    assertThat(controller.previewTreeOperation(null, null, 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(controller.previewTreeOperation(github("123", "account"), "456", 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verifyNoInteractions(provider);
  }

  @Test
  void fileEditRejectsUnsavedOrDifferentRepositoryAndBranchBeforeWriting() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(provider.browseReady()).thenReturn(true);
    var request = new GithubTargetController.EditFileRequest("main", "solution.java", "source", "Edit", "a".repeat(40), "b".repeat(40));
    var missing = new GithubTargetController(users, provider, mock(UserSettingsRepository.class));
    assertThat(missing.editFile(github("123", "account"), "123", 44L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    var saved = new GithubTargetController(users, provider, savedTarget(user));
    var otherBranch = new GithubTargetController.EditFileRequest("feature", "solution.java", "source", "Edit", "a".repeat(40), "b".repeat(40));
    assertThat(saved.editFile(github("123", "account"), "123", 44L, 7L, otherBranch).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(saved.editFile(github("123", "account"), "123", 45L, 7L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(saved.editFile(github("123", "account"), "123", 44L, 8L, request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verify(provider, never()).replaceFile(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void treeOperationPreviewAndCommitRecheckSavedTarget() throws Exception {
    UserRepository users = mock(UserRepository.class);
    GithubAppProvider provider = mock(GithubAppProvider.class);
    AppUser user = AppUser.fromGithub("123", "account", "Name", null);
    when(users.findByGithubId("123")).thenReturn(Optional.of(user));
    when(provider.browseReady()).thenReturn(true);
    GithubTargetController controller = new GithubTargetController(users, provider, savedTarget(user));
    var preview = new GithubTargetController.TreeOperationPreviewRequest("DELETE", "other", "old.txt", null, "Delete old.txt", "a".repeat(40));
    assertThat(controller.previewTreeOperation(github("123", "account"), "123", 44L, 7L, preview).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    var confirmation = new GithubTargetController.TreeOperationCommitRequest("signed-preview");
    when(provider.previewBranch("123", 44L, 7L, "signed-preview")).thenReturn("other");
    assertThat(controller.commitTreeOperation(github("123", "account"), "123", 44L, 7L, confirmation).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verify(provider, never()).commitOperation("123", 44L, 7L, "signed-preview");
    when(provider.previewBranch("123", 44L, 7L, "signed-preview")).thenReturn("main");
    assertThat(controller.commitTreeOperation(github("123", "account"), "123", 44L, 7L, confirmation).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    verify(provider, never()).commitOperation("123", 44L, 7L, "signed-preview");
  }

  private static UserSettingsRepository savedTarget(AppUser user) {
    UserSettingsRepository settings = mock(UserSettingsRepository.class);
    UserSettings saved = mock(UserSettings.class);
    when(settings.findByUserId(user.getId())).thenReturn(Optional.of(saved));
    when(saved.githubTargetConfigured()).thenReturn(true);
    when(saved.getGithubInstallationId()).thenReturn(44L);
    when(saved.getGithubOwner()).thenReturn("account");
    when(saved.getGithubRepository()).thenReturn("algorithm");
    when(saved.getGithubBranch()).thenReturn("main");
    return settings;
  }

  private static OAuth2AuthenticationToken github(String id, String login) {
    var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
        Map.of("id", id, "login", login), "id");
    return new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
  }
}
