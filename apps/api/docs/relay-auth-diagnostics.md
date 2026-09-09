# Relay authentication diagnostics

Local candidate based on develop `7d31f946225bb2e0c2d72cc7fb4a7b7a76a25fe6`.
This is diagnostic instrumentation, not a confirmed fix for the beta HTTP 401.

`RequestIdFilter` runs before Spring Security so rejected requests receive the
same request ID in their response header, JSON envelope, and diagnostic log.
Incoming IDs are limited to 128 ASCII identifier characters to prevent log injection.

For the exact relay POST route, look up the popup request ID in API logs:

`relay_auth_rejected requestId=... reason=...`

Reasons: `MISSING_BEARER`, `TOKEN_NOT_FOUND`, `GRANT_REVOKED`, `GRANT_EXPIRED`,
`SESSION_MISSING`, `SESSION_REVOKED`, `SESSION_EXPIRED`,
`AMBIGUOUS_BEARER_AND_COOKIE`, or `DIAGNOSTIC_UNAVAILABLE`.
`VALID_AT_DIAGNOSTIC_CHECK` means the later diagnostic snapshot found a valid
record; it is not an authentication grant and may indicate a concurrent change.

The diagnostic lookup runs only after rejected relay authentication. It uses
the complete credential hash for matching, never the public grant ID alone.
Do not log credentials, hashes, cookies, source, account/device identifiers,
request bodies, or exception details. Detailed reasons stay server-side;
the public error remains `AUTH_REQUIRED`. Authentication predicates are unchanged.

Validation: full security-chain MockMvc tests plus real PostgreSQL relay tests
cover request ID correlation, safe logging, diagnostic failure containment,
valid ingest, duplicate receipt, and revoked/expired authentication.
No provider call is needed for these synthetic fixtures (GitHub automation OFF).

Deployment requires separate approval. Once deployed, obtain one fresh failure
and correlate its request ID before choosing a credential lifecycle fix.
