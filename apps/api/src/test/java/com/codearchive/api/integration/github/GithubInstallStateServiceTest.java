package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.codearchive.api.integration.github.GithubInstallStateService.Failure;
import com.codearchive.api.integration.github.GithubInstallStateService.InstallStateException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;

class GithubInstallStateServiceTest {
    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");

    @Test
    void signsBindsAndConsumesTheStateExactlyOnce() {
        GithubInstallStateService service = service(NOW);
        MockHttpSession session = new MockHttpSession();

        String installUrl = service.issue(17L, "123456", session);
        String state = stateFrom(installUrl);

        assertThat(installUrl).startsWith("https://github.com/apps/codearchive/installations/new?state=");
        assertThat(service.consume(state, 17L, "123456", session).returnPath()).isEqualTo("/");
        assertThatThrownBy(() -> service.consume(state, 17L, "123456", session))
                .isInstanceOfSatisfying(InstallStateException.class,
                        exception -> assertThat(exception.failure()).isEqualTo(Failure.REPLAYED));
    }

    @Test
    void rejectsTamperingWithoutConsumingTheValidPendingState() {
        GithubInstallStateService service = service(NOW);
        MockHttpSession session = new MockHttpSession();
        String state = stateFrom(service.issue(17L, "123456", session));
        String tampered = (state.charAt(0) == 'A' ? "B" : "A") + state.substring(1);

        assertThatThrownBy(() -> service.consume(tampered, 17L, "123456", session))
                .isInstanceOfSatisfying(InstallStateException.class,
                        exception -> assertThat(exception.failure()).isEqualTo(Failure.INVALID));
        assertThat(service.consume(state, 17L, "123456", session).userId()).isEqualTo(17L);
    }

    @Test
    void failsClosedForExpiredAndForeignAccountCallbacks() {
        MockHttpSession expiredSession = new MockHttpSession();
        String expiredState = stateFrom(service(NOW).issue(17L, "123456", expiredSession));
        assertThatThrownBy(() -> service(NOW.plusSeconds(600)).consume(expiredState, 17L, "123456", expiredSession))
                .isInstanceOfSatisfying(InstallStateException.class,
                        exception -> assertThat(exception.failure()).isEqualTo(Failure.EXPIRED));

        MockHttpSession foreignSession = new MockHttpSession();
        String foreignState = stateFrom(service(NOW).issue(17L, "123456", foreignSession));
        assertThatThrownBy(() -> service(NOW).consume(foreignState, 18L, "654321", foreignSession))
                .isInstanceOfSatisfying(InstallStateException.class,
                        exception -> assertThat(exception.failure()).isEqualTo(Failure.ACCOUNT_MISMATCH));
    }

    @Test
    void signedSetupRoutingDoesNotNeedTheOriginalSessionOrConsumeTheState() {
        GithubInstallStateService service = service(NOW);
        MockHttpSession legacySession = new MockHttpSession();
        String legacy = stateFrom(service.issue(17L, "123456", legacySession));
        MockHttpSession directSession = new MockHttpSession();
        String direct = stateFrom(service.issue(17L, "123456", directSession, true));

        assertThat(service.setupReturn(legacy)).contains(false);
        assertThat(service.setupReturn(direct)).contains(true);
        // The actual fixed callback, with its original cookie, still consumes it.
        assertThat(service.consume(legacy, 17L, "123456", legacySession).version()).isEqualTo(1);
        assertThat(service.consume(direct, 17L, "123456", directSession).version()).isEqualTo(2);
    }

    @Test
    void expiredDirectStateCanOnlySelectTheFixedErrorLanding() {
        MockHttpSession session = new MockHttpSession();
        String direct = stateFrom(service(NOW).issue(17L, "123456", session, true));
        GithubInstallStateService expired = service(NOW.plusSeconds(601));

        assertThat(expired.setupReturn(direct)).isEmpty();
        assertThat(expired.errorReturn(direct)).contains(true);
    }

    private static GithubInstallStateService service(Instant instant) {
        return new GithubInstallStateService("codearchive", "server-only-private-key", Duration.ofMinutes(10),
                new ObjectMapper(), Clock.fixed(instant, ZoneOffset.UTC), new SecureRandom());
    }

    private static String stateFrom(String installUrl) {
        String query = URI.create(installUrl).getRawQuery();
        return URLDecoder.decode(query.substring("state=".length()), StandardCharsets.UTF_8);
    }
}
