package com.codearchive.api.settings;
public record SettingsResponse(long version, String name, String nickname, boolean copyHeader, boolean downloadHeader,
    String downloadFilenameTemplate, String gitPathTemplate, String lightTheme, String darkTheme, boolean autoSyncEnabled,
    boolean githubAutoCommitEnabled, boolean githubTargetConfigured, String githubStatus, Long githubInstallationId,
    String githubOwner, String githubRepository, String githubBranch, String githubRootPath, String githubSetupUrl) {
  static SettingsResponse from(UserSettings s, boolean providerReady, String appSlug) { boolean target = s.githubTargetConfigured(); String status=!providerReady?"PROVIDER_UNAVAILABLE":!target?"TARGET_MISSING":"AVAILABLE"; String setup=appSlug==null||appSlug.isBlank()?null:"https://github.com/apps/"+appSlug+"/installations/new"; return new SettingsResponse(s.getVersion(), s.getDisplayName(), s.getNickname(), s.isCopyHeader(), s.isDownloadHeader(), s.getDownloadFilenameTemplate(), s.getGitPathTemplate(), s.getLightTheme(), s.getDarkTheme(), s.isAutoSyncEnabled(), s.isGithubAutoCommitEnabled()&&providerReady, target, status, s.getGithubInstallationId(), s.getGithubOwner(), s.getGithubRepository(), s.getGithubBranch(), s.getGithubRootPath(), setup); }
}
