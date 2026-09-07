package com.codearchive.api.automation;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.config.DashboardOriginValidator;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;

@Service
public class DurableAutomationProfileService {

    private final DurableAutomationProfileStore store;
    private final AuthProperties authProperties;
    private final Clock clock;

    @Autowired
    public DurableAutomationProfileService(DurableAutomationProfileStore store, AuthProperties authProperties) {
        this(store, authProperties, Clock.systemUTC());
    }

    DurableAutomationProfileService(DurableAutomationProfileStore store, AuthProperties authProperties, Clock clock) {
        this.store = store;
        this.authProperties = authProperties;
        this.clock = clock;
    }

    public DurableAutomationProfileStore.Profile get(CodeArchivePrincipal principal, String origin) {
        requireDashboard(principal, origin);
        DurableAutomationProfileStore.Profile guarded =
                store.ensureSessionBinding(principal.userId(), principal.sessionId(), clock.instant());
        return guarded == null ? store.find(principal.userId()) : guarded;
    }

    public DurableAutomationProfileStore.Profile update(CodeArchivePrincipal principal, String origin, UpdateRequest request) {
        requireDashboard(principal, origin);
        if (request == null || request.expectedVersion() < 0) throw invalid();
        store.ensureSessionBinding(principal.userId(), principal.sessionId(), clock.instant());
        String device = requiredDevice(request.deviceId());
        String mode = request.ownershipMode();
        if (!"PAGE_OWNED".equals(mode) && !"DURABLE_SERVER".equals(mode)) throw invalid();
        validateTarget(request.target(), request.githubAutoCommitEnabled());
        if (request.githubAutoCommitEnabled() && (!request.sourceTransferEnabled()
                || !request.automaticTransferConsent() || !request.visibilityRiskConsent()
                || (request.target() != null && !request.target().privateRepository() && !request.publicUploadConsent()))) {
            throw new CodeArchiveException(ErrorCode.AUTOMATION_NOT_ELIGIBLE);
        }

        DurableAutomationProfileStore.Profile current = store.withLock(principal.userId());
        if (current.version() != request.expectedVersion()) throw new CodeArchiveException(ErrorCode.AUTOMATION_GENERATION_STALE);

        boolean changed = current.sourceTransferEnabled() != request.sourceTransferEnabled()
                || current.githubAutoCommitEnabled() != request.githubAutoCommitEnabled()
                || !java.util.Objects.equals(current.deviceId(), device)
                || !java.util.Objects.equals(current.target(), request.target())
                || !current.ownershipMode().equals(mode)
                || current.automaticTransferConsent() != request.automaticTransferConsent()
                || current.visibilityRiskConsent() != request.visibilityRiskConsent()
                || current.publicUploadConsent() != request.publicUploadConsent();
        long generation = changed ? current.generation() + 1 : current.generation();
        long targetGeneration = java.util.Objects.equals(current.target(), request.target())
                ? current.targetGeneration() : current.targetGeneration() + 1;
        Instant enabledAt = request.githubAutoCommitEnabled()
                ? (current.githubAutoCommitEnabled() && !changed ? current.githubEnabledAt() : clock.instant()) : null;
        return store.update(principal.userId(), principal.sessionId(), device, request.sourceTransferEnabled(), request.githubAutoCommitEnabled(),
                mode, targetGeneration, request.target(), request.automaticTransferConsent(),
                request.visibilityRiskConsent(), request.publicUploadConsent(), request.expectedVersion(),
                enabledAt, generation, clock.instant());
    }

    private void validateTarget(GitHubAutoCommitStore.Target target, boolean required) {
        if (!required) return;
        if (target == null || target.installationId() <= 0 || target.repositoryId() <= 0
                || target.branch() == null || !target.branch().matches("[A-Za-z0-9._/-]{1,255}")
                || target.expectedCommitSha() == null || !target.expectedCommitSha().matches("[0-9a-f]{40}")
                || target.folder() == null || target.folder().length() > 1024
                || target.fullName() == null || !target.fullName().matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}")) throw invalid();
    }

    private String requiredDevice(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{16,128}")) throw invalid();
        return value;
    }

    private void requireDashboard(CodeArchivePrincipal principal, String origin) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        String expected = DashboardOriginValidator.normalize(authProperties.getDashboardOrigin()).orElse(null);
        if (expected == null || !expected.equals(origin)) throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
    }

    private CodeArchiveException invalid() { return new CodeArchiveException(ErrorCode.INVALID_REQUEST); }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    public record UpdateRequest(String deviceId, boolean sourceTransferEnabled, boolean githubAutoCommitEnabled,
            String ownershipMode, GitHubAutoCommitStore.Target target,
            boolean automaticTransferConsent, boolean visibilityRiskConsent, boolean publicUploadConsent,
            long expectedVersion) {}
}
