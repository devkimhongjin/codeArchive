package com.codearchive.api.settings;
public record SettingsRequest(long version, String name, String nickname, boolean copyHeader, boolean downloadHeader, boolean githubHeader,
    String downloadFilenameTemplate, String gitPathTemplate, String githubCommitMessageTemplate, String lightTheme, String darkTheme, boolean autoSyncEnabled,
    boolean githubAutoCommitEnabled, Long githubInstallationId, String githubOwner, String githubRepository, String githubBranch, String githubRootPath) {}
