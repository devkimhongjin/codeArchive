# Issue 241 architecture and runbook

## Account settings

`GET` and optimistic `PUT /api/settings` are session-authenticated.  The immutable
CodeArchive user id is never accepted from a client.  `version` must be echoed by a
writer; a stale update receives `409`.  Download names and Git paths intentionally
use separate templates: download names reject directories, while Git paths must be
relative and cannot traverse outside the configured root.

The supported Shiki selections are `github-light`, `vitesse-light`,
`catppuccin-latte`, `solarized-light`, `one-light` and `github-dark`,
`vitesse-dark`, `catppuccin-mocha`, `dracula`, `one-dark-pro`.  All are exact Shiki
4.4.3 IDs.  Unsupported languages are displayed as plain text.

## Relay and automation boundary

The Dashboard obtains `POST /api/relay/grants` while authenticated and provides the
result to the paired extension through its capability-fenced bridge.  A grant is a
32-byte random opaque bearer, SHA-256 hashed at rest, device/generation bound and
revocable. `DELETE /api/relay/grants/{deviceId}` is an authenticated, CSRF-fenced,
idempotent account-scoped revocation endpoint. Settings generation changes and
logout revoke active grants as well. The extension persists only this bearer, account id, generation and
relay endpoint; it has no GitHub OAuth, App, installation or repository token.
An explicit extension OFF stops local sending immediately, then uses the bearer-only
`DELETE /api/relay/grants/self` endpoint to revoke that same grant. Offline OFF is
retained as `REVOCATION_PENDING` and retried by the bounded alarm drain; the bearer
is erased only after confirmation (or expiry).

`POST /api/relay/captures` and `DELETE /api/relay/grants/self` are the two
unauthenticated-session bearer-only routes. The append endpoint derives the user
from its grant and uses the existing `(user,captureId)` idempotency key; self-revoke
can only invalidate that same grant. Both are excluded from CSRF because they do not
use cookies; all other API routes retain session/CSRF protection. Local IndexedDB is committed before relay.
No successful acknowledgement is inferred until the API stores the capture.

`github_commit_jobs` is an additive durable ledger. The concrete server-only GitHub
App provider activates only when `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are
configured and an installation is selected in account settings (optional
`CODEARCHIVE_GITHUB_API_BASE` is available for a controlled test endpoint). It mints
a short-lived installation token, re-reads branch HEAD and target generation
immediately before a create-only non-force ref update. A configured target without
those App credentials reports `PROVIDER_UNAVAILABLE`; no write is attempted. Never
retry an unknown possibly-sent provider mutation; leave it `UNKNOWN` for operator
review.

The scheduler processes only `PENDING` jobs. It revalidates the settings generation,
both automation flags, target configuration and capture before invoking the injectable
provider boundary. Retryable pre-write failures are bounded to three attempts;
`UNKNOWN` is terminal and is never automatically retried. The concrete provider
stays fail-closed while the required server configuration is absent.
Automatic GitHub writes currently support personal-owner repositories only: the
requested owner must equal the authenticated GitHub login. Organization installation
selection is deferred until a dedicated App-install authorization callback can bind
an installation to the immutable account. A fresh `RUNNING` worker lease is never
reclaimed; only stale leases become terminal `UNKNOWN`.

## Memory migration

V5 preserves `solutions.memory_usage` for compatibility. It never assigns a unit to
that legacy number. New captures use `memory_value` plus `memory_unit` (`KB`, `KiB`,
`MB`, `MiB`, `UNKNOWN`); UI renders legacy values as `단위 미확인`.
Programmers' authoritative result row supplies MB. The supported SWEA solving page
does not expose an authoritative metric row locally, so its captures intentionally
remain `UNKNOWN` rather than guessing KB.
