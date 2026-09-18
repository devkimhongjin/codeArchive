package com.codearchive.api.settings;

import com.codearchive.api.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

/** Account-owned preferences. OAuth identity never participates in this mutable profile. */
@Entity
@Table(name = "user_settings")
public class UserSettings {
    @Id private Long userId;
    @OneToOne @MapsId @JoinColumn(name = "user_id") private AppUser user;
    @Version private long version;
    @Column(name = "display_name") private String displayName;
    private String nickname;
    @Column(name = "copy_header") private boolean copyHeader;
    @Column(name = "download_header") private boolean downloadHeader;
    @Column(name = "download_filename_template") private String downloadFilenameTemplate = "Solution_{number}_{name}";
    @Column(name = "git_path_template") private String gitPathTemplate = "{platform}/{number}-{title}";
    @Column(name = "github_commit_message_template") private String githubCommitMessageTemplate = "Add {platform} {number} solution";
    @Column(name = "light_theme") private String lightTheme = "github-light";
    @Column(name = "dark_theme") private String darkTheme = "github-dark";
    @Column(name = "auto_sync_enabled") private boolean autoSyncEnabled;
    @Column(name = "github_auto_commit_enabled") private boolean githubAutoCommitEnabled;
    @Column(name = "github_installation_id") private Long githubInstallationId;
    @Column(name = "github_owner") private String githubOwner;
    @Column(name = "github_repository") private String githubRepository;
    @Column(name = "github_branch") private String githubBranch;
    @Column(name = "github_root_path") private String githubRootPath;
    @Column(name = "automation_enabled_at") private Instant automationEnabledAt;
    protected UserSettings() {}
    public UserSettings(AppUser user) { this.user = user; }
    public long getVersion() { return version; } public String getDisplayName() { return displayName; } public String getNickname() { return nickname; }
    public boolean isCopyHeader() { return copyHeader; } public boolean isDownloadHeader() { return downloadHeader; }
    public String getDownloadFilenameTemplate() { return downloadFilenameTemplate; } public String getGitPathTemplate() { return gitPathTemplate; }
    public String getGithubCommitMessageTemplate() { return githubCommitMessageTemplate; }
    public String getLightTheme() { return lightTheme; } public String getDarkTheme() { return darkTheme; }
    public boolean isAutoSyncEnabled() { return autoSyncEnabled; } public boolean isGithubAutoCommitEnabled() { return githubAutoCommitEnabled; }
    public Long getGithubInstallationId() { return githubInstallationId; } public String getGithubOwner() { return githubOwner; } public String getGithubRepository() { return githubRepository; }
    public String getGithubBranch() { return githubBranch; } public String getGithubRootPath() { return githubRootPath; } public Instant getAutomationEnabledAt() { return automationEnabledAt; } public AppUser getUser() { return user; }
    public boolean githubTargetConfigured() { return githubInstallationId != null && nonBlank(githubOwner) && nonBlank(githubRepository) && nonBlank(githubBranch); }
    public void apply(SettingsRequest r) {
        boolean automationWasEnabled = autoSyncEnabled && githubAutoCommitEnabled;
        // Changing a destination or path changes the meaning of queued source.
        // Treat it as a new consent generation even if both toggles stay on.
        String nextCommitMessageTemplate = r.githubCommitMessageTemplate() == null ? githubCommitMessageTemplate : r.githubCommitMessageTemplate();
        boolean automationTargetChanged = !java.util.Objects.equals(gitPathTemplate, r.gitPathTemplate())
                || !java.util.Objects.equals(githubCommitMessageTemplate, nextCommitMessageTemplate)
                || !java.util.Objects.equals(githubInstallationId, r.githubInstallationId())
                || !java.util.Objects.equals(githubOwner, r.githubOwner())
                || !java.util.Objects.equals(githubRepository, r.githubRepository())
                || !java.util.Objects.equals(githubBranch, r.githubBranch())
                || !java.util.Objects.equals(githubRootPath, r.githubRootPath());
        displayName = r.name(); nickname = r.nickname(); copyHeader = r.copyHeader(); downloadHeader = r.downloadHeader();
        downloadFilenameTemplate = r.downloadFilenameTemplate(); gitPathTemplate = r.gitPathTemplate(); githubCommitMessageTemplate = nextCommitMessageTemplate; lightTheme = r.lightTheme(); darkTheme = r.darkTheme();
        autoSyncEnabled = r.autoSyncEnabled(); githubInstallationId = r.githubInstallationId(); githubOwner = r.githubOwner(); githubRepository = r.githubRepository(); githubBranch = r.githubBranch(); githubRootPath = r.githubRootPath();
        githubAutoCommitEnabled = r.githubAutoCommitEnabled() && githubTargetConfigured();
        if (autoSyncEnabled && githubAutoCommitEnabled && (!automationWasEnabled || automationTargetChanged)) automationEnabledAt = Instant.now();
    }
    /** Logout is an account-consent boundary. Keep profile/export/theme/target
     * data intact, but make every queued or in-flight automation generation stale. */
    public void revokeAutomationConsent() {
        autoSyncEnabled = false;
        githubAutoCommitEnabled = false;
        automationEnabledAt = Instant.now();
    }
    private static boolean nonBlank(String value) { return value != null && !value.isBlank(); }
}
