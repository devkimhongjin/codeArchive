package com.codearchive.api.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestCorrelationFilterTest {
    @Test
    void reusesSafeRenderRequestIdAndClearsMdc() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Rndr-Id", "rndr_ABC-123");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new RequestCorrelationFilter().doFilter(request, response, new MockFilterChain());

        assertEquals("rndr_ABC-123", response.getHeader(RequestCorrelationFilter.RESPONSE_HEADER));
        assertFalse(MDC.getCopyOfContextMap() != null
                && MDC.getCopyOfContextMap().containsKey(RequestCorrelationFilter.MDC_KEY));
    }

    @Test
    void replacesUnsafeCorrelationInput() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Rndr-Id", "attacker\nforged-log-line");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new RequestCorrelationFilter().doFilter(request, response, new MockFilterChain());

        String requestId = response.getHeader(RequestCorrelationFilter.RESPONSE_HEADER);
        assertNotNull(requestId);
        assertFalse(requestId.contains("attacker"));
    }
}
