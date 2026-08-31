package com.codearchive.api.integration.github;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
    private final GitHubAppProperties properties;

    @Autowired
    public GitHubHttpAppClient(GitHubAppJwt jwt, GitHubAppProperties properties) {
        this(jwt, productionClient(), properties);
    }

    GitHubHttpAppClient(GitHubAppJwt jwt, RestClient client) {
        this(jwt, client, new GitHubAppProperties());
    }

    GitHubHttpAppClient(GitHubAppJwt jwt, RestClient client, GitHubAppProperties properties) {
        this.jwt = jwt;
        this.client = client;
        this.properties = properties;
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
        String token = issueToken(installationId, Map.of("metadata", "read"), null);
        return repositoryPage(token, page);
    }

    private String issueToken(long installationId, Map<String, String> requestedPermissions, Long repositoryId) {
        Map<String, ?> payload = repositoryId == null
                ? Map.of("permissions", requestedPermissions)
                : Map.of("permissions", requestedPermissions, "repository_ids", List.of(repositoryId));
        JsonNode issued = read(client.post()
                .uri(API + "/app/installations/{id}/access_tokens", installationId)
                .contentType(MediaType.APPLICATION_JSON)
                .body(payload), jwt.issue());
        String token = text(issued, "token");
        // GitHub also issues ghs_APPID_JWT tokens. Treat them as opaque Bearer values.
        require(token.length() <= 16384 && token.matches("[A-Za-z0-9._~+/=-]+"));
        JsonNode permissions = issued.path("permissions");
        require(permissions.isObject() && permissions.size() == requestedPermissions.size());
        requestedPermissions.forEach((name, value) -> require(value.equals(permissions.path(name).asText())));
        try {
            Instant expires = Instant.parse(text(issued, "expires_at"));
            require(expires.isAfter(Instant.now()) && expires.isBefore(Instant.now().plusSeconds(3660)));
        } catch (java.time.format.DateTimeParseException ignored) {
            throw invalidResponse();
        }
        return token;
    }

    private RepositoryPage repositoryPage(String token, int page) {
        return repositoryPage(token, page, false);
    }

    private RepositoryPage repositoryPage(String token, int page, boolean singleRepository) {
        JsonNode body = read(client.get().uri(API
                + "/installation/repositories?per_page={size}&page={page}", PAGE_SIZE, page), token);
        JsonNode repositories = body.path("repositories");
        JsonNode total = body.path("total_count");
        require(repositories.isArray() && repositories.size() <= PAGE_SIZE
                && total.isIntegralNumber() && total.canConvertToLong() && total.longValue() >= 0);
        if (singleRepository && total.longValue() != 1) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        }
        var result = new ArrayList<Repository>();
        for (JsonNode repository : repositories) {
            String name = text(repository, "name");
            require(name.matches("[A-Za-z0-9_.-]{1,100}") && !name.equals(".") && !name.equals(".."));
            require(repository.path("private").isBoolean());
            JsonNode branch = repository.path("default_branch");
            require(branch.isNull() || (branch.isTextual() && branch.textValue().length() <= 1024));
            result.add(new Repository(id(repository), account(repository.path("owner")), name,
                    repository.path("private").booleanValue(), branch.isNull() ? null : branch.textValue()));
        }
        return new RepositoryPage(result, (long) page * PAGE_SIZE < total.longValue());
    }

    private JsonNode read(RestClient.RequestHeadersSpec<?> request, String token) {
        JsonNode body = readResponse(request, token).getBody();
        require(body != null && body.isObject());
        return body;
    }

    private ResponseEntity<JsonNode> readResponse(RestClient.RequestHeadersSpec<?> request, String token) {
        try {
            ResponseEntity<JsonNode> responseEntity = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
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
                            case 409 -> ErrorCode.GITHUB_REPOSITORY_STATE_UNAVAILABLE;
                            default -> ErrorCode.EXTERNAL_API_ERROR;
                        });
                    }).toEntity(JsonNode.class);
            require(responseEntity.getBody() != null);
            return responseEntity;
        } catch (CodeArchiveException failure) {
            throw failure;
        } catch (Exception ignored) {
            // No raw bodies, headers, tokens, URLs, or transport exception causes escape this boundary.
            throw invalidResponse();
        }
    }


    @Override
    public BranchPage listBranches(long installationId, long repositoryId, long ownerId, int page) {
        GitHubBrowseInput.identifiers(installationId, repositoryId);
        GitHubBrowseInput.page(page);
        RepositoryAccess access = selectedRepository(installationId, repositoryId, ownerId);
        ResponseEntity<JsonNode> response = readResponse(client.get().uri(access.base()
                + "/branches?per_page={size}&page={page}", PAGE_SIZE, page), access.token);
        JsonNode branches = response.getBody();
        require(branches != null && branches.isArray() && branches.size() <= PAGE_SIZE);
        var result = new ArrayList<Branch>();
        var names = new HashSet<String>();
        for (JsonNode branch : branches) {
            String name = text(branch, "name");
            require(name.length() <= 1024 && names.add(name) && branch.path("protected").isBoolean());
            result.add(new Branch(name, sha(branch.path("commit"), "sha"), branch.path("protected").booleanValue(),
                    GitHubBrowseInput.validBranch(name)));
        }
        // Inspect pagination metadata only; never follow a provider-controlled URL.
        boolean hasMore = response.getHeaders().getOrEmpty(HttpHeaders.LINK).stream()
                .anyMatch(value -> value.contains("rel=\"next\""));
        return new BranchPage(List.copyOf(result), hasMore);
    }

    @Override
    public Directory readDirectory(long installationId, long repositoryId, long ownerId,
            String branch, String expectedCommitSha, String path) {
        GitHubBrowseInput.identifiers(installationId, repositoryId);
        GitHubBrowseInput.reference(branch, expectedCommitSha);
        List<String> segments = GitHubBrowseInput.directory(path);
        RepositoryAccess access = selectedRepository(installationId, repositoryId, ownerId);
        JsonNode selectedBranch = matchingBranch(access, branch, expectedCommitSha);
        String commitSha = expectedCommitSha;
        String rootTreeSha = sha(selectedBranch.path("commit").path("commit").path("tree"), "sha");
        String treeSha = rootTreeSha;
        String currentPath = "";
        List<TreeEntry> entries = tree(access, treeSha, currentPath);
        for (String segment : segments) {
            TreeEntry child = entries.stream()
                    .filter(entry -> entry.name().equals(segment) && entry.browsable()).findFirst()
                    .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_PATH_NOT_FOUND));
            treeSha = child.sha();
            currentPath = child.path();
            entries = tree(access, treeSha, currentPath);
        }
        return new Directory(branch, commitSha, rootTreeSha, treeSha, path, entries);
    }


    @Override
    public UploadTarget inspectUploadTarget(long installationId, long repositoryId, long ownerId,
            String branch, String expectedCommitSha, String path) {
        GitHubBrowseInput.identifiers(installationId, repositoryId);
        GitHubBrowseInput.reference(branch, expectedCommitSha);
        List<String> segments = GitHubUploadPath.segments(path);
        RepositoryAccess access = selectedRepository(installationId, repositoryId, ownerId);
        JsonNode selectedBranch = matchingBranch(access, branch, expectedCommitSha);
        require(selectedBranch.path("protected").isBoolean());
        boolean protectedBranch = selectedBranch.path("protected").booleanValue();
        String rootSha = sha(selectedBranch.path("commit").path("commit").path("tree"), "sha");
        List<TreeEntry> entries = tree(access, rootSha, "");
        String prefix = "";
        for (int index = 0; index < segments.size() - 1; index++) {
            String segment = segments.get(index);
            TreeEntry child = entries.stream().filter(entry -> entry.name().equals(segment)).findFirst().orElse(null);
            if (child == null) {
                // Absence is proved only by a complete parent tree, never by a provider 404.
                var missing = new ArrayList<String>();
                for (int rest = index; rest < segments.size() - 1; rest++) {
                    prefix = prefix.isEmpty() ? segments.get(rest) : prefix + "/" + segments.get(rest);
                    missing.add(prefix);
                }
                return new UploadTarget(access.repository, branch, expectedCommitSha, rootSha,
                        protectedBranch, List.copyOf(missing), null, null);
            }
            if (!child.browsable()) {
                return new UploadTarget(access.repository, branch, expectedCommitSha, rootSha,
                        protectedBranch, List.of(), null, child);
            }
            prefix = child.path();
            entries = tree(access, child.sha(), prefix);
        }
        String filename = segments.getLast();
        TreeEntry existing = entries.stream().filter(entry -> entry.name().equals(filename)).findFirst().orElse(null);
        return new UploadTarget(access.repository, branch, expectedCommitSha, rootSha,
                protectedBranch, List.of(), existing, null);
    }

    private JsonNode matchingBranch(RepositoryAccess access, String branch, String expectedCommitSha) {
        JsonNode selected = read(client.get().uri(access.base() + "/branches/{branch}", branch), access.token);
        require(branch.equals(text(selected, "name")));
        if (!expectedCommitSha.equals(sha(selected.path("commit"), "sha"))) {
            throw new CodeArchiveException(ErrorCode.GITHUB_REFERENCE_CHANGED);
        }
        return selected;
    }

    private RepositoryAccess selectedRepository(long installationId, long repositoryId, long ownerId) {
        if (!properties.isContentsReadEnabled()) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        }
        // Scope the token to the single requested ID before resolving names or reading any branch.
        String token = issueToken(installationId, Map.of("metadata", "read", "contents", "read"), repositoryId);
        RepositoryPage page = repositoryPage(token, 1, true);
        if (page.hasMore() || page.repositories().size() != 1) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        }
        Repository repository = page.repositories().getFirst();
        if (repository.id() != repositoryId || repository.owner().id() != ownerId
                || !repository.owner().type().equals("User")) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        }
        return new RepositoryAccess(token, repository);
    }

    private List<TreeEntry> tree(RepositoryAccess access, String expectedTreeSha, String parent) {
        // Omit recursive entirely: even recursive=false asks GitHub for a recursive tree.
        JsonNode tree = read(client.get().uri(access.base() + "/git/trees/{sha}", expectedTreeSha), access.token);
        require(sha(tree, "sha").equals(expectedTreeSha));
        JsonNode items = tree.path("tree");
        require(items.isArray() && tree.path("truncated").isBoolean());
        if (tree.path("truncated").booleanValue() || items.size() > 1000) {
            throw new CodeArchiveException(ErrorCode.GITHUB_DIRECTORY_LIMIT_EXCEEDED);
        }
        var result = new ArrayList<TreeEntry>();
        var names = new HashSet<String>();
        for (JsonNode item : items) {
            String name = text(item, "path");
            require(!name.contains("/") && !name.equals(".") && !name.equals("..") && names.add(name));
            String mode = text(item, "mode");
            String type = text(item, "type");
            EntryType entryType = switch (mode) {
                case "040000" -> { require(type.equals("tree")); yield EntryType.DIRECTORY; }
                case "100644", "100755" -> { require(type.equals("blob")); yield EntryType.FILE; }
                case "120000" -> { require(type.equals("blob")); yield EntryType.SYMLINK; }
                case "160000" -> { require(type.equals("commit")); yield EntryType.SUBMODULE; }
                default -> throw invalidResponse();
            };
            String path = parent.isEmpty() ? name : parent + "/" + name;
            result.add(new TreeEntry(name, path, entryType, sha(item, "sha"),
                    entryType == EntryType.DIRECTORY && GitHubBrowseInput.validDirectory(path)));
        }
        return List.copyOf(result);
    }

    private static String sha(JsonNode node, String field) {
        String sha = text(node, field);
        require(GitHubBrowseInput.validSha(sha));
        return sha;
    }

    // Never use a record/toString that would print the request-local installation token.
    private static final class RepositoryAccess {
        private final String token;
        private final Repository repository;

        RepositoryAccess(String token, Repository repository) {
            this.token = token;
            this.repository = repository;
        }

        String base() {
            return API + "/repos/" + repository.owner().login() + "/" + repository.name();
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
