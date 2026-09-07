package com.codearchive.api.automation;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Starts bounded durable work after relay persistence commits. Startup recovery
 * covers a process crash between the database commit and event delivery; no
 * periodic scheduler is required.
 */
@Component
public class DurableAutomationSignalDispatcher {

    static final int MAX_INVOCATIONS_PER_SIGNAL = 25;

    private final DurableAutomationWorker worker;

    public DurableAutomationSignalDispatcher(DurableAutomationWorker worker) {
        this.worker = worker;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterRelayCaptureCommit(RelayCapturePersistedEvent event) {
        drain();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void afterApplicationReady(ApplicationReadyEvent event) {
        drain();
    }

    void recoverAtStartup() {
        drain();
    }

    private void drain() {
        for (int attempt = 0; attempt < MAX_INVOCATIONS_PER_SIGNAL; attempt++) {
            DurableAutomationWorker.Result result = worker.runOnce();
            if (result == null || !"SUCCEEDED".equals(result.status())) return;
        }
    }
}
