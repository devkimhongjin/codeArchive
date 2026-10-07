package com.codearchive.api.config;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.codearchive.api.auth.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
class DesktopOAuthRoutingTest {
    private OAuth2AuthenticationToken auth() {
        var authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
        var principal = new GithubOAuth2User(authorities, Map.of("id", "101", "login", "test"), new GithubIdentity("101", "test", null, null));
        return new OAuth2AuthenticationToken(principal, authorities, "github");
    }
    @Test void activeDesktopLoginAsksForApprovalWhileOrdinaryWebLoginKeepsItsRoot() throws Exception {
        var login = mock(DesktopLoginService.class);
        var properties = new GithubOAuth2Properties(); properties.setDashboardOrigin("http://localhost:5173");
        var handler = new GithubOAuth2SuccessHandler(mock(GithubAccountService.class), properties, login);
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        request.getSession().setAttribute(DesktopLoginService.SESSION_KEY, "a".repeat(64));
        handler.onAuthenticationSuccess(request, response, auth());
        assertThat(response.getRedirectedUrl()).isEqualTo("/api/desktop-auth/confirm");
        var ordinary = new MockHttpServletResponse(); handler.onAuthenticationSuccess(new MockHttpServletRequest(), ordinary, auth());
        assertThat(ordinary.getRedirectedUrl()).isEqualTo("http://localhost:5173/");
    }
    @Test void expiredInstallIntentNeverHijacksASubsequentWebLogin() throws Exception {
        var properties = new GithubOAuth2Properties(); properties.setDashboardOrigin("http://localhost:5173");
        var handler = new GithubOAuth2SuccessHandler(mock(GithubAccountService.class), properties, mock(DesktopLoginService.class));
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        request.getSession().setAttribute(DesktopLoginService.INSTALL_KEY, new DesktopLoginService.InstallIntent("101", 1));
        handler.onAuthenticationSuccess(request, response, auth());
        assertThat(response.getRedirectedUrl()).isEqualTo("http://localhost:5173/");
        assertThat(request.getSession().getAttribute(DesktopLoginService.INSTALL_KEY)).isNull();
    }
    @Test void consentedDesktopLoginApprovesOnlyTheFreshOAuthAccountAndReturnsToTheApp() throws Exception {
        var login = mock(DesktopLoginService.class);
        var handler = new GithubOAuth2SuccessHandler(mock(GithubAccountService.class), new GithubOAuth2Properties(), login);
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        String id = "a".repeat(64);
        request.getSession().setAttribute(DesktopLoginService.SESSION_KEY, id);
        request.getSession().setAttribute(DesktopLoginService.CONSENT_KEY, id);
        handler.onAuthenticationSuccess(request, response, auth());
        verify(login).approve(id, "101");
        assertThat(response.getRedirectedUrl()).isEqualTo("/api/desktop-auth/complete");
        assertThat(request.getSession().getAttribute(DesktopLoginService.SESSION_KEY)).isNull();
        assertThat(request.getSession().getAttribute(DesktopLoginService.CONSENT_KEY)).isNull();
        assertThat(request.getSession().getAttribute(DesktopLoginService.COMPLETED_KEY)).isInstanceOf(Long.class);
    }
    @Test void mismatchedConsentCannotApproveANativeLogin() throws Exception {
        var login = mock(DesktopLoginService.class);
        var handler = new GithubOAuth2SuccessHandler(mock(GithubAccountService.class), new GithubOAuth2Properties(), login);
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        request.getSession().setAttribute(DesktopLoginService.SESSION_KEY, "a".repeat(64));
        request.getSession().setAttribute(DesktopLoginService.CONSENT_KEY, "b".repeat(64));
        handler.onAuthenticationSuccess(request, response, auth());
        verify(login, never()).approve(anyString(), anyString());
        assertThat(response.getRedirectedUrl()).isEqualTo("/api/desktop-auth/confirm");
    }
    @Test void oauthFailureCancelsThePendingNativeHandoff() throws Exception {
        var login = mock(DesktopLoginService.class);
        var handler = new GithubOAuth2FailureHandler(new GithubOAuth2Properties(), login);
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        request.getSession().setAttribute(DesktopLoginService.SESSION_KEY, "a".repeat(64));
        request.getSession().setAttribute(DesktopLoginService.CONSENT_KEY, "a".repeat(64));
        handler.onAuthenticationFailure(request, response, new org.springframework.security.authentication.BadCredentialsException("test"));
        verify(login).cancel("a".repeat(64));
        assertThat(request.getSession().getAttribute(DesktopLoginService.SESSION_KEY)).isNull();
        assertThat(request.getSession().getAttribute(DesktopLoginService.CONSENT_KEY)).isNull();
        assertThat(response.getRedirectedUrl()).isEqualTo("/api/desktop-auth/failed");
    }
}
