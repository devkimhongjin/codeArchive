package com.codearchive.api.integration.github;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;

@Component
public class GitHubHttpAppClient implements GitHubAppClient {
    private static final String API = "https://api.github.com";
    private final GitHubAppJwt jwt;
    private final RestClient client;

    @Autowired
    public GitHubHttpAppClient(GitHubAppJwt jwt) {
        this(jwt, productionClient());
    }

    GitHubHttpAppClient(GitHubAppJwt jwt, RestClient client) {
        this.jwt = jwt;
        this.client = client;
    }

    private static RestClient productionClient() {
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(10));
        return RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public Optional<Installation> findPersonalInstallation(String githubLogin) {
        if (githubLogin == null || !githubLogin.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}")) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        }
        JsonNode body;
        try {
            body = read(client.get().uri(API + "/users/{login}/installation", githubLogin), jwt.issue());
        } catch (CodeArchiveException failure) {
            if (failure.getErrorCode() == ErrorCode.GITHUB_INTEGRATION_NOT_FOUND) {
                return Optional.empty();
            }
            throw failure;
        }
        String selection = text(body, "repository_selection");
        require(selection.equals("all") || selection.equals("selected"));
        require(body.has("suspended_at"));
        return Optional.of(new Installation(id(body), account(body.path("account")), selection,
                !body.path("suspended_at").isNull()));
    }

    @Override
    public RepositoryPage listRepositories(long installationId, int page) {
        require(installationId > 0 && page >= 1 && page <= 10000);
        JsonNode issued = read(client.post()
                .uri(API + "/app/installations/{id}/access_tokens", installationId)
                .contentType(MediaType.APPLICATION_JSON)
                // Never inherit broader granted permissions (in particular Contents write).
                .body(Map.of("permissions", Map.of("metadata", "read"))), jwt.issue());
        String token = text(issued, "token");
        require(token.matches("[A-Za-z0-9_]+"));
        JsonNode permissions = issued.path("permissions");
        require(permissions.isObject() && permissions.size() == 1
                && permissions.path("metadata").asText().equals("read"));
        try {
            Instant expires = Instant.parse(text(issued, "expires_at"));
            require(expires.isAfter(Instant.now()) && expires.isBefore(Instant.now().plusSeconds(3660)));
        } catch (java.time.format.DateTimeParseException ignored) {
            throw invalidResponse();
        }

        JsonNode body = read(client.get().uri(API
                + "/installation/repositories?per_page={size}&page={page}", PAGE_SIZE, page), token);
        JsonNode repositories = body.path("repositories");
        JsonNode total = body.path("total_count");
        require(repositories.isArray() && repositories.size() <= PAGE_SIZE
                && total.isIntegralNumber() && total.canConvertToLong() && total.longValue() >= 0);
        var result = new ArrayList<Repository>();
        for (JsonNode repository : repositories) {
            String name = text(repository, "name");
            require(name.matches("[A-Za-z0-9_.-]{1,100}"));
            require(repository.path("private").isBoolean());
            JsonNode branch = repository.path("default_branch");
            require(branch.isNull() || (branch.isTextual() && branch.textValue().length() <= 1024));
            result.add(new Repository(id(repository), account(repository.path("owner")), name,
                    repository.path("private").booleanValue(), branch.isNull() ? null : branch.textValue()));
        }
        return new RepositoryPage(result, (long) page * PAGE_SIZE < total.longValue());
    }

    private JsonNode read(RestClient.RequestHeadersSpec<?> request, String token) {
        try {
            JsonNode body = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .header(HttpHeaders.ACCEPT, "application/vnd.github+json")
                    .header("X-GitHub-Api-Version", "2026-03-10")
                    .header(HttpHeaders.USER_AGENT, "CodeArchive")
                    .retrieve().onStatus(status -> !status.is2xxSuccessful(), (sent, response) -> {
                        int status = response.getStatusCode().value();
                        HttpHeaders headers = response.getHeaders();
                        if (status == 429 || (status == 403 && (
                                "0".equals(headers.getFirst("X-RateLimit-Remaining"))
                                || headers.containsKey(HttpHeaders.RETRY_AFTER)))) {
                            throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
                        }
                        throw new CodeArchiveException(switch (status) {
                            case 401 -> ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE;
                            case 403 -> ErrorCode.ACCESS_DENIED;
                            case 404 -> ErrorCode.GITHUB_INTEGRATION_NOT_FOUND;
                            default -> ErrorCode.EXTERNAL_API_ERROR;
                        });
                    }).body(JsonNode.class);
            require(body != null && body.isObject());
            return body;
        } catch (CodeArchiveException failure) {
            throw failure;
        } catch (Exception ignored) {
            // No raw bodies, headers, tokens, URLs, or transport exception causes escape this boundary.
            throw invalidResponse();
        }
    }

    private static Account account(JsonNode node) {
        String login = text(node, "login");
        require(login.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}"));
        String type = text(node, "type");
        require(type.equals("User") || type.equals("Organization"));
        return new Account(id(node), login, type);
    }

    private static long id(JsonNode node) {
        JsonNode value = node.path("id");
        require(value.isIntegralNumber() && value.canConvertToLong() && value.longValue() > 0);
        return value.longValue();
    }

    private static String text(JsonNode node, String key) {
        JsonNode value = node.path(key);
        require(value.isTextual() && !value.textValue().isBlank());
        return value.textValue();
    }

    private static void require(boolean condition) {
        if (!condition) throw invalidResponse();
    }

    private static CodeArchiveException invalidResponse() {
        return new CodeArchiveException(ErrorCode.EXTERNAL_API_ERROR);
    }
}
