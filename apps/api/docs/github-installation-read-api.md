# GitHub installation / repository read API — #44, slice 1

Priority: [owner handoff](https://github.com/devkimhongjin/codeArchive/issues/44#issuecomment-5479144590).
This API foundation precedes Dashboard consent/connection UI, branch/tree browsing, preview, and explicit commits.
It does not finish #44 or enable uploading. The separate
[branch/directory browsing slice](github-repository-browse-api.md) adds repository-specific Contents read
behind its own disabled-by-default gate; the metadata-list contract below is unchanged.

## Identity and scope

Only personal GitHub account installations are supported. The current server user's GitHub login locates
the App installation, and its immutable GitHub user ID must match the installation account ID.
A reused username cannot grant access to another account. Organizations/collaborator repositories
need a separate GitHub App user authorization/membership contract and are excluded.

No binding or token is persisted. Every request rechecks the installation with GitHub.
Missing, suspended, or different-owner installations grant no access. Repository enumeration starts
only after the requested installation ID matches this check. GitHub restricts the repository list to
the installation; returned metadata is additionally filtered to the verified personal owner.
The App installation may cover all repositories or selected repositories; this choice is returned.
No contents, branches, solution records, or ACKs are read or changed.

## Response contract

Both GETs require the existing CodeArchive session and use the standard
`{success,data,error,requestId}` envelope. Response IDs are decimal strings.

- `GET /api/v1/integrations/github/installations`
  - data: `{installations: [{id, account: {id,login,type:"User"}, repositorySelection}]}`
  - repositorySelection: selected or all. No eligible installation: successful empty array.
  - Disabled integration: 503, not an empty array.
- `GET /api/v1/integrations/github/installations/{installationId}/repositories?page=1`
  - data: `{installationId,repositories:[{id,name,fullName,private,defaultBranch,htmlUrl}],page,perPage:30,hasMore}`
  - page: integer 1–10000; installation ID: positive signed 64-bit integer.
  - Fixed GitHub page size; no following Link URLs or unbounded enumeration.
  - Empty pages are valid; defaultBranch may be null and does not prove a branch exists.
  - hasMore describes upstream pagination; owner filtering can leave an empty page with more pages.
  - Links are constructed on https://github.com from validated owner/name, not raw provider URLs.

Client userId/owner/repo inputs cannot grant access. Success is private/no-store; the security filter
also prevents caching authenticated errors. No server selection cache survives account switch.
The future UI must discard old selections and late responses.

| Condition | Status / safe error |
| --- | --- |
| Missing/invalid CodeArchive session | 401 AUTH_REQUIRED |
| Disabled/missing/bad App credentials, GitHub 401 | 503 GITHUB_INTEGRATION_UNAVAILABLE |
| Other account, suspended/missing installation for repositories, GitHub 404 outside discovery | 404 GITHUB_INTEGRATION_NOT_FOUND |
| GitHub permission denied | 403 ACCESS_DENIED |
| GitHub 429 or 403 with rate-limit remaining=0 / Retry-After | 429 RATE_LIMITED |
| Malformed input | 400 INVALID_REQUEST |
| Malformed upstream, redirects, transport error, other upstream failures | 502 EXTERNAL_API_ERROR |

GitHub failures do not clear a valid CodeArchive login. Errors contain no provider bodies, URLs,
headers, keys, tokens, repository descriptions, or source code. No automatic retry.

## Server configuration — not provisioned or enabled by this change

- GITHUB_APP_INTEGRATION_ENABLED: false by default.
- GITHUB_APP_ID: numeric App ID, independent of ordinary login settings.
- GITHUB_APP_PRIVATE_KEY_PKCS8: unencrypted RSA PKCS#8 PEM, minimum 2048 bits, actual newlines.
  Header must be BEGIN PRIVATE KEY. A downloaded PKCS#1 RSA PRIVATE KEY must first be securely
  converted by the operator. Never put keys in source, tickets, logs, browser, or Extension.

Bad/missing configuration fails only integration requests, not application startup/login.
App JWT: RS256, issued-at minus 60 seconds, expiry plus 5 minutes.
Outbound HTTPS: fixed api.github.com host, redirects disabled, 5-second connect and 10-second read
timeout per request. Listing explicitly mints metadata:read installation tokens and validates
returned permissions and expiry (standard one-hour lifetime plus a clock allowance).
Tokens remain in request-local server memory; no token persistence, serialization, or content-write grant.

Actual App creation/installation consent, permissions, secrets, deployment, and writes remain
separate owner gates. Future Dashboard consent is separate from login. This API does not start
consent or accept a browser installation callback as proof of ownership.
No Web, shared types, Extension, auth scopes, provider configuration, migrations, dependencies, or Production changes.

## Verification

- Mock MVC with real security filter/service and mocked auth/provider: sessions, server identity,
  two-account isolation, reused login, suspension/organization exclusion, uninstall between requests,
  owner filtering, pagination/input validation, safe errors.
- Mock HTTP: endpoints/auth schemes, metadata-only tokens, bounded pages, empty/malformed responses,
  ignored provider fields, token scope/expiry, status/rate limits, no retry or secret/error leakage.
- Cryptographic test verifies RSA signature and JWT claims; disabled/bad configuration fails safely.
- Full Java 21 Gradle/PostgreSQL Testcontainers CI required; tests use no real App credentials.

Official contracts:
[personal installation](https://docs.github.com/en/rest/apps/apps#get-a-user-installation-for-the-authenticated-app),
[installation token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
[repository list](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation),
[App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app).
