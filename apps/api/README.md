# CodeArchive API

Spring Boot API for GitHub OAuth2 session authentication and solution captures.

## Run locally with H2

The `local` profile uses a file-backed H2 database in `apps/api/data`:

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17-or-newer"
$env:SPRING_PROFILES_ACTIVE = "local"
.\mvnw.cmd spring-boot:run
```

## Run with PostgreSQL

The default profile uses PostgreSQL. Set the connection values before starting:

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17-or-newer"
$env:DATABASE_URL = "jdbc:postgresql://localhost:5432/codearchive"
$env:DB_USERNAME = "codearchive"
$env:DB_PASSWORD = "replace-with-a-secret"
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
.\mvnw.cmd spring-boot:run
```

GitHub login is enabled only when both `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` are set. The backend owns both values; the dashboard
never receives a client secret. The default GitHub callback is
`http://localhost:5173/api/login/oauth2/code/github`. Set
`GITHUB_REDIRECT_URI` when the registered GitHub OAuth application uses a
different exact callback, and set `DASHBOARD_ORIGIN` to the fixed dashboard
origin used after login (default `http://localhost:5173`).

For production, `DB_PASSWORD` is required by `application-prod.yml`; use `SPRING_PROFILES_ACTIVE=prod` with a managed PostgreSQL instance. The production profile creates and uses only the `codearchive_v2` Flyway/Hibernate schema, leaving `public` tables and `public.flyway_schema_history` untouched. It exposes unauthenticated liveness at `GET /actuator/health`; all other API security remains unchanged. See [docs/database-migrations.md](docs/database-migrations.md) before adopting an existing database.

## API contract

The API uses a server session (`JSESSIONID`) created by the GitHub OAuth2
authorization-code flow. `GET /api/auth/providers` reports whether the
backend has both GitHub credentials and exposes the fixed login path
`/api/oauth2/authorization/github`. When credentials are absent, that start
path returns `503`; no fake or local-password login is attempted.

On successful login, `GET /api/auth/me` returns the local account keyed by the
immutable GitHub numeric id:

```json
{"id":1,"githubId":"12345","githubLogin":"octocat","name":"The Octocat","email":"octocat@example.com"}
```

`name` and `email` may be omitted when GitHub does not provide them. `POST
/api/auth/logout` invalidates the session. The old `/api/auth/register` and
`/api/auth/login` routes return `410 Gone` and never read submitted password
values.

CSRF is enabled for all state-changing requests. First call `GET /api/auth/csrf`:

```json
{"headerName":"X-XSRF-TOKEN","token":"..."}
```

The response also sets an `XSRF-TOKEN` cookie. Send the returned token as `X-XSRF-TOKEN` on `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `POST /api/solutions/bulk`. The dashboard should send `credentials: "include"`.

Authenticated solution endpoints:

- `GET /api/solutions` returns the current user's solutions as an array.
- `POST /api/solutions/bulk` accepts `{ "captures": [...] }` and returns `{ "acceptedCaptureIds": [...], "failures": [{ "captureId": "...", "message": "..." }] }`.

The dashboard should send its last known `githubId` in `X-CodeArchive-Account`
on both solution requests. The API compares that assertion with the GitHub
principal and returns `409` if another tab changed the session account; the
header never grants access. Calls without the header remain accepted for
older clients.

Each capture must include a UUID `captureId`, `platform` (`SWEA`, `PROGRAMMERS`, or `JUNGOL`), `problemNumber`, `title`, `problemUrl`, `language`, `sourceCode`, `result` (`ACCEPTED`), `observedAt`, and `solvedAt` as ISO-8601 timestamps. `executionTime` and `memoryUsage` are optional non-negative numbers. Invalid items fail independently so valid items in the same batch remain stored.

The `(user_id, capture_id)` database constraint makes retries idempotent and prevents one user from reading another user's captures. A replay with changed core solution data is rejected; a replay can enrich missing performance fields.

## GitHub App installation callback

Configure the GitHub App **Setup URL** to the public dashboard origin followed by
`/api/github/installations/callback`. For the beta deployment this is:

```text
https://codearchive-dashboard-beta.netlify.app/api/github/installations/callback
```

The dashboard starts installation with an authenticated, CSRF-protected `POST`.
The API signs a short-lived state, binds it to the current browser session, and
validates both that state and the immutable GitHub account before accepting the
returned `installation_id`. It does not require the optional `setup_action` query
parameter because GitHub's Setup URL contract guarantees only `installation_id`;
the state and installation ownership lookup are the security boundaries. The
GitHub App ID, private key, and slug must all be configured server-side as
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_SLUG`. Deployments
that already store the PKCS#8 key as `GITHUB_APP_PRIVATE_KEY_PKCS8` remain
supported; the canonical `GITHUB_APP_PRIVATE_KEY` takes precedence when both
are present. The private key and installation tokens are never sent to the
dashboard or extension.

## Tests

Tests use the in-memory H2 `test` profile and mock the OAuth principal, so no
real GitHub credentials or external request is required. They cover CSRF,
disabled-provider behavior, removed password routes, immutable GitHub identity
and profile refresh, missing email, logout, user isolation, idempotent replay,
account assertions, partial bulk failures, legacy-session rejection, and an
invalid OAuth callback state:

```powershell
.\mvnw.cmd test
```
