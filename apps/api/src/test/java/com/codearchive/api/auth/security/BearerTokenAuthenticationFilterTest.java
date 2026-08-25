package com.codearchive.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import com.codearchive.api.auth.AuthService;

import jakarta.servlet.FilterChain;

@ExtendWith(MockitoExtension.class)
class BearerTokenAuthenticationFilterTest {

    @Mock
    private AuthService authService;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void validBearerTokenSetsCodeArchivePrincipal() throws Exception {
        CodeArchivePrincipal principal =
                new CodeArchivePrincipal(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "tester"
                );
        when(authService.authenticate("access-token"))
                .thenReturn(Optional.of(principal));

        MockHttpServletRequest request =
                new MockHttpServletRequest();
        request.addHeader(
                "Authorization",
                "Bearer access-token"
        );
        MockHttpServletResponse response =
                new MockHttpServletResponse();
        AtomicReference<Authentication> observed =
                new AtomicReference<>();
        FilterChain chain = (req, res) ->
                observed.set(
                        SecurityContextHolder
                                .getContext()
                                .getAuthentication()
                );

        new BearerTokenAuthenticationFilter(
                authService
        ).doFilter(request, response, chain);

        assertThat(observed.get()).isNotNull();
        assertThat(observed.get().getPrincipal())
                .isEqualTo(principal);
    }

    @Test
    void unknownBearerTokenLeavesRequestUnauthenticated()
            throws Exception {
        when(authService.authenticate("unknown-token"))
                .thenReturn(Optional.empty());

        MockHttpServletRequest request =
                new MockHttpServletRequest();
        request.addHeader(
                "Authorization",
                "Bearer unknown-token"
        );
        MockHttpServletResponse response =
                new MockHttpServletResponse();
        AtomicReference<Authentication> observed =
                new AtomicReference<>();
        FilterChain chain = (req, res) ->
                observed.set(
                        SecurityContextHolder
                                .getContext()
                                .getAuthentication()
                );

        new BearerTokenAuthenticationFilter(
                authService
        ).doFilter(request, response, chain);

        assertThat(observed.get()).isNull();
    }
}
