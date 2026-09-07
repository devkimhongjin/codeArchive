package com.codearchive.api.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class RelayGrantAuthenticationFilterTest {

    @Test
    void validRelayCredentialCannotAccessOrdinaryApi() throws Exception {
        RelayGrantService grants = mock(RelayGrantService.class);
        when(grants.authenticate("grant.secret")).thenReturn(Optional.of(principal()));
        RelayGrantAuthenticationFilter filter = new RelayGrantAuthenticationFilter(grants);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(new MockHttpServletRequest("GET", "/api/v1/solutions") {{
            addHeader("Authorization", "Bearer grant.secret");
        }}, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void invalidRelayCredentialCannotIngest() throws Exception {
        RelayGrantService grants = mock(RelayGrantService.class);
        when(grants.authenticate("invalid")).thenReturn(Optional.empty());
        RelayGrantAuthenticationFilter filter = new RelayGrantAuthenticationFilter(grants);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request("POST", "/api/v1/relay/captures", "invalid"), response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void validRelayCredentialIsScopedToIngestAndSetsRelayPrincipal() throws Exception {
        RelayGrantService grants = mock(RelayGrantService.class);
        RelayGrantPrincipal expected = principal();
        when(grants.authenticate("grant.secret")).thenReturn(Optional.of(expected));
        RelayGrantAuthenticationFilter filter = new RelayGrantAuthenticationFilter(grants);
        MockFilterChain chain = new MockFilterChain();

        SecurityContextHolder.clearContext();
        filter.doFilter(request("POST", "/api/v1/relay/captures", "grant.secret"),
                new MockHttpServletResponse(), chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication().getPrincipal()).isEqualTo(expected);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                .anySatisfy(authority -> assertThat(authority.getAuthority()).isEqualTo("RELAY_INGEST"));
        SecurityContextHolder.clearContext();
    }

    private MockHttpServletRequest request(String method, String path, String credential) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.addHeader("Authorization", "Bearer " + credential);
        return request;
    }

    private RelayGrantPrincipal principal() {
        return new RelayGrantPrincipal(UUID.randomUUID(), UUID.randomUUID(), "device-1234567890", 3);
    }
}
