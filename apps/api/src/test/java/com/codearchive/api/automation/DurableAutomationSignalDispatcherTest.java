package com.codearchive.api.automation;

import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class DurableAutomationSignalDispatcherTest {

    @Mock
    private DurableAutomationWorker worker;

    @Test
    void committedRelaySignalDrainsOnlySuccessfulWork() {
        when(worker.runOnce())
                .thenReturn(new DurableAutomationWorker.Result("SUCCEEDED", UUID.randomUUID(), null))
                .thenReturn(new DurableAutomationWorker.Result("IDLE", null, null));
        DurableAutomationSignalDispatcher dispatcher = new DurableAutomationSignalDispatcher(worker);

        dispatcher.afterRelayCaptureCommit(new RelayCapturePersistedEvent(UUID.randomUUID()));

        verify(worker, times(2)).runOnce();
    }

    @Test
    void startupRecoveryIsBounded() {
        when(worker.runOnce()).thenReturn(
                new DurableAutomationWorker.Result("SUCCEEDED", UUID.randomUUID(), null));
        DurableAutomationSignalDispatcher dispatcher = new DurableAutomationSignalDispatcher(worker);

        dispatcher.recoverAtStartup();

        verify(worker, times(DurableAutomationSignalDispatcher.MAX_INVOCATIONS_PER_SIGNAL)).runOnce();
        assertThat(DurableAutomationSignalDispatcher.MAX_INVOCATIONS_PER_SIGNAL).isEqualTo(25);
    }

    @Test
    void workerRuntimeFailureDoesNotEscapePostCommitDispatcher() {
        when(worker.runOnce()).thenThrow(new IllegalStateException("temporary worker failure"));
        DurableAutomationSignalDispatcher dispatcher = new DurableAutomationSignalDispatcher(worker);

        dispatcher.afterRelayCaptureCommit(new RelayCapturePersistedEvent(UUID.randomUUID()));

        verify(worker).runOnce();
    }
}
