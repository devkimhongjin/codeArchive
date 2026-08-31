package com.codearchive.api.integration.github;

import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonProperty;

@Service
public class GitHubIntegrationService {
    private final AuthService authService;
    private final GitHubAppClient client;

    public GitHubIntegrationService(AuthService authService, GitHubAppClient client) {
        this.authService = authService;
        this.client = client;
    }

    public InstallationsResponse installations(CodeArchivePrincipal principal) {
        return new InstallationsResponse(ownedInstallation(principal)
                .map(value -> List.of(new InstallationResponse(Long.toString(value.id()),
                        new AccountResponse(Long.toString(value.account().id()), value.account().login(), "User"),
                        value.repositorySelection())))
                .orElseGet(List::of));
    }

    public RepositoriesResponse repositories(CodeArchivePrincipal principal, long installationId, int page) {
        if (installationId <= 0 || page < 1 || page > 10000) {
            throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        }
        // Re-resolve current GitHub ownership every request; never cache it by a client account ID.
        GitHubAppClient.Installation installation = ownedInstallation(principal)
                .filter(value -> value.id() == installationId)
                .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND));
        GitHubAppClient.RepositoryPage result = client.listRepositories(installationId, page);
        List<RepositoryResponse> repositories = result.repositories().stream()
                .filter(repository -> repository.owner().id() == installation.account().id()
                        && "User".equals(repository.owner().type())
                        && installation.account().login().equalsIgnoreCase(repository.owner().login()))
                .map(repository -> {
                    String fullName = repository.owner().login() + "/" + repository.name();
                    return new RepositoryResponse(Long.toString(repository.id()), repository.name(),
                            fullName, repository.privateRepository(), repository.defaultBranch(),
                            "https://github.com/" + fullName);
                }).toList();
        return new RepositoriesResponse(Long.toString(installationId), repositories,
                page, GitHubAppClient.PAGE_SIZE, result.hasMore());
    }

    private Optional<GitHubAppClient.Installation> ownedInstallation(CodeArchivePrincipal principal) {
        CodeArchiveUser user = authService.currentUser(principal);
        return client.findPersonalInstallation(user.getGithubLogin())
                // A renamed/reused login must never grant the previous account's installation.
                .filter(value -> value.account().id() == user.getGithubUserId()
                        && "User".equals(value.account().type()) && !value.suspended());
    }

    public record AccountResponse(String id, String login, String type) {}
    public record InstallationResponse(String id, AccountResponse account, String repositorySelection) {}
    public record InstallationsResponse(List<InstallationResponse> installations) {}
    public record RepositoryResponse(String id, String name, String fullName,
            @JsonProperty("private") boolean privateRepository, String defaultBranch, String htmlUrl) {}
    public record RepositoriesResponse(String installationId, List<RepositoryResponse> repositories,
            int page, int perPage, boolean hasMore) {}
}
