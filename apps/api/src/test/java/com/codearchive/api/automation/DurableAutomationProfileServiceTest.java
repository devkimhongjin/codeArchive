package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;

@ExtendWith(MockitoExtension.class)
class DurableAutomationProfileServiceTest {

    private static final String ORIGIN = "https://codearchive-dashboard-beta.onrender.com";
    private static final Instant NOW = Instant.parse("2026-09-04T00:00:00Z");
    private static final GitHubAutoCommitStore.Target TARGET = new GitHubAutoCommitStore.Target(
            701, 801, "main", "a".repeat(40), "archive", true, "tester/solutions");

    @Mock DurableAutomationProfileStore store;
    private DurableAutomationProfileService service;
    private CodeArchivePrincipal principal;
    private DurableAutomationProfileStore.Profile current;

    @BeforeEach
    void setUp() {
        AuthProperties properties = new AuthProperties();
        properties.setDashboardOrigin(ORIGIN);
        service = new DurableAutomationProfileService(store, properties, Clock.fixed(NOW, ZoneOffset.UTC));
        principal = new CodeArchivePrincipal(UUID.randomUUID(), UUID.randomUUID(), "tester");
        current = new DurableAutomationProfileStore.Profile(principal.userId(), "device-1234567890",
                4, true, false, "PAGE_OWNED", 2, null, true, true, true, null, 7, NOW);
        when(store.withLock(principal.userId())).thenReturn(current);
    }

    @Test
    void sourceTransferCanStayEnabledWhileDurableGithubAutomationIsOff() {
        DurableAutomationProfileStore.Profile updated = new DurableAutomationProfileStore.Profile(
                principal.userId(), current.deviceId(), 4, true, false, "PAGE_OWNED", 2, null,
                true, true, true, null, 8, NOW);
        when(store.update(any(), any(), anyBoolean(), anyBoolean(), any(), anyLong(), any(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyLong(), any(), anyLong(), any())).thenReturn(updated);

        service.update(principal, ORIGIN, new DurableAutomationProfileService.UpdateRequest(
                current.deviceId(), true, false, "PAGE_OWNED", null, true, true, true, current.version()));

        verify(store, never()).stopPageOwnedRuns(any());
        verify(store, never()).revokeRelayGrants(any(), any());
        verify(store).update(eq(principal.userId()), eq(current.deviceId()), eq(true), eq(false), eq("PAGE_OWNED"),
                eq(2L), isNull(), eq(true), eq(true), eq(true), eq(7L), isNull(), eq(4L), eq(NOW));
    }

    @Test
    void switchingToDurableServerStopsPageOwnedRunsBeforePersistingMode() {
        when(store.update(any(), any(), anyBoolean(), anyBoolean(), any(), anyLong(), any(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyLong(), any(), anyLong(), any())).thenReturn(current);

        service.update(principal, ORIGIN, new DurableAutomationProfileService.UpdateRequest(
                current.deviceId(), true, false, "DURABLE_SERVER", null, true, true, true, current.version()));

        verify(store, never()).stopPageOwnedRuns(any());
        verify(store).update(eq(principal.userId()), eq(current.deviceId()), eq(true), eq(false), eq("DURABLE_SERVER"),
                eq(2L), isNull(), eq(true), eq(true), eq(true), eq(7L), isNull(), eq(5L), eq(NOW));
    }

    @Test
    void switchingBackToPageOwnedIsRejectedWhileDurableClaimIsLive() {
        DurableAutomationProfileStore.Profile durable = new DurableAutomationProfileStore.Profile(
                principal.userId(), current.deviceId(), 5, true, true, "DURABLE_SERVER", 2, TARGET,
                true, true, true, NOW, 8, NOW);
        when(store.withLock(principal.userId())).thenReturn(durable);
        when(store.update(any(), any(), anyBoolean(), anyBoolean(), any(), anyLong(), any(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyLong(), any(), anyLong(), any()))
                .thenThrow(new CodeArchiveException(ErrorCode.AUTOMATION_OWNERSHIP_CONFLICT));

        assertThatThrownBy(() -> service.update(principal, ORIGIN, new DurableAutomationProfileService.UpdateRequest(
                current.deviceId(), true, true, "PAGE_OWNED", TARGET, true, true, true, durable.version())))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode())
                                .isEqualTo(ErrorCode.AUTOMATION_OWNERSHIP_CONFLICT));
        verify(store).update(any(), any(), anyBoolean(), anyBoolean(), any(), anyLong(), any(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyLong(), any(), anyLong(), any());
    }

    @Test
    void staleVersionCannotChangeGenerationOrOwnership() {
        assertThatThrownBy(() -> service.update(principal, ORIGIN, new DurableAutomationProfileService.UpdateRequest(
                current.deviceId(), true, false, "DURABLE_SERVER", null, true, true, true, current.version() - 1)))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode())
                                .isEqualTo(ErrorCode.AUTOMATION_GENERATION_STALE));
        verify(store, never()).stopPageOwnedRuns(any());
        verify(store, never()).update(any(), any(), anyBoolean(), anyBoolean(), any(), anyLong(), any(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyLong(), any(), anyLong(), any());
    }
}
