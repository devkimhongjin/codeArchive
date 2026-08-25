package com.codearchive.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import com.codearchive.api.ai.AnalysisClient.AnalysisRequest;
import com.codearchive.api.ai.AnalysisClient.AnalysisResult;
import com.sun.net.httpserver.HttpServer;

class HttpAnalysisClientTest {

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void sendsOnlyMinimalAnalysisPayloadWithInternalBearer()
            throws IOException {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();

        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/internal/v1/analysis", exchange -> {
            authorization.set(
                    exchange.getRequestHeaders().getFirst("Authorization")
            );
            body.set(new String(
                    exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8
            ));
            byte[] response = """
                    {
                      "content": "generated",
                      "provider": "fake",
                      "model": "fake-v1"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add(
                    "Content-Type",
                    "application/json"
            );
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        AnalysisClientProperties properties =
                new AnalysisClientProperties();
        properties.setBaseUrl(
                "http://127.0.0.1:" + server.getAddress().getPort()
        );
        properties.setInternalToken("INTERNAL_TEST_TOKEN");
        properties.setRequestTimeout(Duration.ofSeconds(2));

        HttpAnalysisClient client = new HttpAnalysisClient(
                RestClient.builder(),
                properties
        );

        AnalysisResult result = client.analyze(
                new AnalysisRequest(
                        AiArtifactType.CODE_REVIEW,
                        "SOURCE_MARKER",
                        "SWEA",
                        "1234",
                        "Example",
                        "Java"
                )
        );

        assertThat(result.content()).isEqualTo("generated");
        assertThat(result.provider()).isEqualTo("fake");
        assertThat(result.model()).isEqualTo("fake-v1");
        assertThat(authorization.get())
                .isEqualTo("Bearer INTERNAL_TEST_TOKEN");

        assertThat(body.get())
                .contains("\"task\":\"CODE_REVIEW\"")
                .contains("\"code\":\"SOURCE_MARKER\"")
                .contains("\"platform\":\"SWEA\"")
                .contains("\"problemNumber\":\"1234\"")
                .contains("\"title\":\"Example\"")
                .contains("\"language\":\"Java\"")
                .doesNotContain("userId")
                .doesNotContain("problemBody")
                .doesNotContain("sample")
                .doesNotContain("github")
                .doesNotContain("cookie");
    }
}
