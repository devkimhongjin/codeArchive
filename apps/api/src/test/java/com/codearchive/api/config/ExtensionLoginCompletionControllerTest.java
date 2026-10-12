package com.codearchive.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ExtensionLoginCompletionControllerTest {
    @Test
    void completionIsAnInertNoStoreDocumentForTopLevelTabReturn() {
        var response = new ExtensionLoginCompletionController().complete();
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getCacheControl()).contains("no-store");
        assertThat(response.getHeaders().getFirst("Content-Security-Policy"))
                .contains("default-src 'none'").contains("form-action 'none'");
        assertThat(response.getBody()).doesNotContain("script").doesNotContain("github");
    }
}
