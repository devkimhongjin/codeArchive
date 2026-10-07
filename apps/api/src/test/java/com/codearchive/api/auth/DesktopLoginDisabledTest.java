package com.codearchive.api.auth;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
class DesktopLoginDisabledTest {
    @Test void disabledFeatureAllocatesNoRequestsAndCannotExchangeASession() {
        var requests = mock(DesktopLoginRepository.class);
        var login = new DesktopLoginService(requests, mock(UserRepository.class), mock(jakarta.persistence.EntityManager.class), false);
        var create = (DesktopLoginService.Failure) catchThrowable(() -> login.create("a".repeat(43), "127.0.0.1"));
        var exchange = (DesktopLoginService.Failure) catchThrowable(() -> login.exchange("a".repeat(43), "b".repeat(43)));
        assertThat(create.status).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(exchange.status).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        verifyNoInteractions(requests);
    }
}
