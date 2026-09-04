package com.codearchive.api.relay;

import java.util.UUID;

/** Authentication result for the append-only relay only. */
public record RelayGrantPrincipal(
        UUID userId,
        UUID grantId,
        String deviceId,
        long generation
) {
}
