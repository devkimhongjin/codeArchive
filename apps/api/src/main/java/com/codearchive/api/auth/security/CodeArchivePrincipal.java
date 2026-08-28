package com.codearchive.api.auth.security;

import java.util.UUID;

public record CodeArchivePrincipal(
        UUID userId,
        UUID sessionId,
        String githubLogin
) {
}
