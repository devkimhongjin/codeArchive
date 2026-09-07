package com.codearchive.api.automation;

import java.util.UUID;

/** Published inside the relay transaction and handled only after that transaction commits. */
public record RelayCapturePersistedEvent(UUID userId) {}
