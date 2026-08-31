package com.codearchive.api.integration.github;

import java.util.List;
import java.util.Optional;

public interface GitHubAppClient {
    int PAGE_SIZE = 30;

    Optional<Installation> findPersonalInstallation(String githubLogin);
    RepositoryPage listRepositories(long installationId, int page);
    BranchPage listBranches(long installationId, long repositoryId, long ownerId, int page);
    Directory readDirectory(long installationId, long repositoryId, long ownerId,
            String branch, String expectedCommitSha, String path);
    UploadTarget inspectUploadTarget(long installationId, long repositoryId, long ownerId,
            String branch, String expectedCommitSha, String path);
    PreparedCommit prepareCommit(CommitSelection selection);

    record CommitSelection(long installationId, long repositoryId, long ownerId, String branch,
            String expectedCommitSha, String path, boolean privateRepository, String fullName) {
        @Override public String toString() { return "CommitSelection[redacted]"; }
    }
    interface PreparedCommit { CommitResult create(String source, String message); }
    record CommitResult(String sha, String url) {}

    record Account(long id, String login, String type) {}
    record Installation(long id, Account account, String repositorySelection, boolean suspended) {}
    record Repository(long id, Account owner, String name, boolean privateRepository, String defaultBranch) {}
    record RepositoryPage(List<Repository> repositories, boolean hasMore) {}
    record Branch(String name, String commitSha, boolean protectedBranch, boolean selectable) {}
    record BranchPage(List<Branch> branches, boolean hasMore) {}
    enum EntryType { DIRECTORY, FILE, SYMLINK, SUBMODULE }
    record TreeEntry(String name, String path, EntryType type, String sha, boolean browsable) {}
    record Directory(String branch, String commitSha, String rootTreeSha, String treeSha,
            String path, List<TreeEntry> entries) {}
    record UploadTarget(Repository repository, String branch, String commitSha, String rootTreeSha,
            boolean protectedBranch, List<String> missingDirectories, TreeEntry existingEntry, TreeEntry obstruction) {}
}
