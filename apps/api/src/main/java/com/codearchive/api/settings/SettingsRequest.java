package com.codearchive.api.settings;
public record SettingsRequest(long version, String name, String nickname, boolean copyHeader, boolean downloadHeader, boolean githubHeader,
    String downloadFilenameTemplate, String gitPathTemplate, String githubCommitMessageTemplate, String lightTheme, String darkTheme, boolean autoSyncEnabled,
    boolean githubAutoCommitEnabled, Long githubInstallationId, String githubOwner, String githubRepository, String githubBranch, String githubRootPath,
    java.util.List<String> copyHeaderFields, java.util.List<String> downloadHeaderFields, java.util.List<String> githubHeaderFields,
    Boolean communityPublicByDefault) {
  public SettingsRequest(long version, String name, String nickname, boolean copyHeader, boolean downloadHeader, boolean githubHeader,
      String downloadFilenameTemplate, String gitPathTemplate, String githubCommitMessageTemplate, String lightTheme, String darkTheme, boolean autoSyncEnabled,
      boolean githubAutoCommitEnabled, Long githubInstallationId, String githubOwner, String githubRepository, String githubBranch, String githubRootPath,
      java.util.List<String> copyHeaderFields, java.util.List<String> downloadHeaderFields, java.util.List<String> githubHeaderFields) {
    this(version, name, nickname, copyHeader, downloadHeader, githubHeader, downloadFilenameTemplate, gitPathTemplate, githubCommitMessageTemplate,
        lightTheme, darkTheme, autoSyncEnabled, githubAutoCommitEnabled, githubInstallationId, githubOwner, githubRepository, githubBranch, githubRootPath,
        copyHeaderFields, downloadHeaderFields, githubHeaderFields, null);
  }
  public SettingsRequest(long version, String name, String nickname, boolean copyHeader, boolean downloadHeader, boolean githubHeader,
      String downloadFilenameTemplate, String gitPathTemplate, String githubCommitMessageTemplate, String lightTheme, String darkTheme, boolean autoSyncEnabled,
      boolean githubAutoCommitEnabled, Long githubInstallationId, String githubOwner, String githubRepository, String githubBranch, String githubRootPath) {
    this(version, name, nickname, copyHeader, downloadHeader, githubHeader, downloadFilenameTemplate, gitPathTemplate, githubCommitMessageTemplate,
        lightTheme, darkTheme, autoSyncEnabled, githubAutoCommitEnabled, githubInstallationId, githubOwner, githubRepository, githubBranch, githubRootPath,
        null, null, null, null);
  }
}
