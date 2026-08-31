package com.codearchive.api.integration.github;

import java.util.List;
import java.util.Optional;
import java.util.ArrayList;

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
        GitHubAppClient.Installation installation = requireInstallation(principal, installationId);
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

    public BranchesResponse branches(CodeArchivePrincipal principal, long installationId, long repositoryId, int page) {
        GitHubBrowseInput.identifiers(installationId, repositoryId);
        GitHubBrowseInput.page(page);
        var installation = requireInstallation(principal, installationId);
        var result = client.listBranches(installationId, repositoryId, installation.account().id(), page);
        return new BranchesResponse(Long.toString(installationId), Long.toString(repositoryId),
                result.branches().stream().map(branch -> new BranchResponse(branch.name(), branch.commitSha(),
                        branch.protectedBranch(), branch.selectable())).toList(),
                page, GitHubAppClient.PAGE_SIZE, result.hasMore());
    }

    public DirectoryResponse directory(CodeArchivePrincipal principal, long installationId, long repositoryId,
            String branch, String expectedCommitSha, String path) {
        GitHubBrowseInput.identifiers(installationId, repositoryId);
        GitHubBrowseInput.reference(branch, expectedCommitSha);
        List<String> segments = GitHubBrowseInput.directory(path);
        var installation = requireInstallation(principal, installationId);
        var result = client.readDirectory(installationId, repositoryId, installation.account().id(),
                branch, expectedCommitSha, path);
        var breadcrumbs = new ArrayList<Breadcrumb>();
        breadcrumbs.add(new Breadcrumb("/", ""));
        String prefix = "";
        for (String segment : segments) {
            prefix = prefix.isEmpty() ? segment : prefix + "/" + segment;
            breadcrumbs.add(new Breadcrumb(segment, prefix));
        }
        String parentPath = path.isEmpty() ? null : path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "";
        return new DirectoryResponse(Long.toString(installationId), Long.toString(repositoryId),
                result.branch(), result.commitSha(), result.rootTreeSha(), result.treeSha(), result.path(),
                parentPath, List.copyOf(breadcrumbs), result.entries(), false);
    }

    GitHubAppClient.Installation requireInstallation(CodeArchivePrincipal principal, long installationId) {
        return ownedInstallation(principal).filter(value -> value.id() == installationId)
                .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_NOT_FOUND));
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
    public record BranchResponse(String name, String commitSha,
            @JsonProperty("protected") boolean protectedBranch, boolean selectable) {}
    public record BranchesResponse(String installationId, String repositoryId,
            List<BranchResponse> branches, int page, int perPage, boolean hasMore) {}
    public record Breadcrumb(String name, String path) {}
    public record DirectoryResponse(String installationId, String repositoryId, String branch,
            String commitSha, String rootTreeSha, String treeSha, String path, String parentPath,
            List<Breadcrumb> breadcrumbs, List<GitHubAppClient.TreeEntry> entries, boolean truncated) {}
}
