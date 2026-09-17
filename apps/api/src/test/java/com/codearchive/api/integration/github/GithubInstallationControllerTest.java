package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import com.codearchive.api.config.GithubOAuth2Properties;
import com.codearchive.api.integration.github.GithubInstallStateService.Failure;
import com.codearchive.api.integration.github.GithubInstallStateService.InstallStateException;
import com.codearchive.api.integration.github.GithubInstallStateService.Payload;
import jakarta.servlet.http.HttpSession;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

class GithubInstallationControllerTest {
    private UserRepository users;
    private GithubAppProvider github;
    private GithubInstallStateService states;
    private GithubInstallationController controller;
    private AppUser user;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        github = mock(GithubAppProvider.class);
        states = mock(GithubInstallStateService.class);
        GithubOAuth2Properties properties = new GithubOAuth2Properties();
        properties.setDashboardOrigin("https://dashboard.example.test");
        controller = new GithubInstallationController(users, github, states, properties);
        user = mock(AppUser.class);
        when(user.getId()).thenReturn(17L);
        when(user.getGithubId()).thenReturn("123");
        when(users.findByGithubId("123")).thenReturn(Optional.of(user));
        when(github.browseReady()).thenReturn(true);
        when(states.ready()).thenReturn(true);
    }

    @Test
    void returnsExistingInstallationsWithoutIssuingAState() throws Exception {
        when(github.installations("123")).thenReturn(List.of(new GithubAppProvider.InstallationChoice(44L, "account")));

        var response = controller.start(github("123", "account"), "123", new MockHttpSession());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        var body = (GithubInstallationController.StartResponse) response.getBody();
        assertThat(body.status()).isEqualTo("AVAILABLE");
        assertThat(body.installations()).extracting(GithubAppProvider.InstallationChoice::id).containsExactly(44L);
        verify(states, never()).issue(anyLong(), anyString(), any(HttpSession.class));
    }

    @Test
    void issuesAnInstallUrlOnlyWhenNoInstallationExists() throws Exception {
        MockHttpSession session = new MockHttpSession();
        when(github.installations("123")).thenReturn(List.of());
        when(states.issue(17L, "123", session)).thenReturn("https://github.com/apps/codearchive/installations/new?state=signed");

        var response = controller.start(github("123", "account"), "123", session);

        var body = (GithubInstallationController.StartResponse) response.getBody();
        assertThat(body.status()).isEqualTo("INSTALL_REQUIRED");
        assertThat(body.installUrl()).contains("state=signed");
    }

    @Test
    void callbackConsumesStateAndRechecksInstallationOwnership() throws Exception {
        MockHttpSession session = new MockHttpSession();
        when(states.consume("signed", 17L, "123", session))
                .thenReturn(new Payload(1, 17L, "123", 1L, 2L, "nonce", "/"));
        when(github.installations("123")).thenReturn(List.of(new GithubAppProvider.InstallationChoice(44L, "account")));

        var response = controller.callback(github("123", "account"), "signed", 44L, "install", session);

        assertThat(response.getStatusCode().value()).isEqualTo(302);
        assertThat(response.getHeaders().getLocation()).hasToString(
                "https://dashboard.example.test/?githubInstall=success&installationId=44");
    }

    @Test
    void callbackReturnsOnlyFixedFailureCodes() {
        MockHttpSession session = new MockHttpSession();
        when(states.consume("expired-state", 17L, "123", session))
                .thenThrow(new InstallStateException(Failure.EXPIRED));

        var response = controller.callback(github("123", "account"), "expired-state", 44L, "install", session);

        assertThat(response.getHeaders().getLocation()).hasToString(
                "https://dashboard.example.test/?githubInstall=expired");
    }

    @Test
    void callbackRejectsAnInstallationThatBelongsToAnotherAccount() throws Exception {
        MockHttpSession session = new MockHttpSession();
        when(states.consume("signed", 17L, "123", session))
                .thenReturn(new Payload(1, 17L, "123", 1L, 2L, "nonce", "/"));
        when(github.installations("123")).thenReturn(List.of());

        var response = controller.callback(github("123", "account"), "signed", 99L, "install", session);

        assertThat(response.getHeaders().getLocation()).hasToString(
                "https://dashboard.example.test/?githubInstall=account_mismatch");
    }

    private static OAuth2AuthenticationToken github(String id, String login) {
        var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", id, "login", login), "id");
        return new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
    }
}
