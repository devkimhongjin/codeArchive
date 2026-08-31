package com.codearchive.api.integration.github;

import java.util.List;
import java.util.Optional;

public interface GitHubAppClient {
    int PAGE_SIZE = 30;

    Optional<Installation> findPersonalInstallation(String githubLogin);
    RepositoryPage listRepositories(long installationId, int page);

    record Account(long id, String login, String type) {}
    record Installation(long id, Account account, String repositorySelection, boolean suspended) {}
    record Repository(long id, Account owner, String name, boolean privateRepository, String defaultBranch) {}
    record RepositoryPage(List<Repository> repositories, boolean hasMore) {}
}

