package com.codearchive.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.InsufficientAuthenticationException;

import com.codearchive.api.common.filter.RequestIdFilter;

class JsonAuthenticationEntryPointTest {

    @Test
    void unauthenticatedRequestReturnsStructured401() throws Exception {
        MockHttpServletRequest request =
                new MockHttpServletRequest();
        request.setAttribute(
                RequestIdFilter.REQUEST_ID_ATTRIBUTE,
                "request-123"
        );
        MockHttpServletResponse response =
                new MockHttpServletResponse();

        new JsonAuthenticationEntryPoint().commence(
                request,
                response,
                new InsufficientAuthenticationException(
                        "not authenticated"
                )
        );

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString())
                .contains("\"code\":\"AUTH_REQUIRED\"")
                .contains("\"requestId\":\"request-123\"")
                .doesNotContain("not authenticated");
    }
}
