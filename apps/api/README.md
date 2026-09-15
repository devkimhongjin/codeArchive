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

For production, `DB_PASSWORD` is required by `application-prod.yml`; use `SPRING_PROFILES_ACTIVE=prod` with a managed PostgreSQL instance. The default and production profiles apply PostgreSQL schema changes through Flyway and use Hibernate `validate`; the local and test H2 profiles retain their existing Hibernate schema generation. See [docs/database-migrations.md](docs/database-migrations.md) before adopting an existing database.

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

Each capture must include a UUID `captureId`, `platform` (`SWEA` or `PROGRAMMERS`), `problemNumber`, `title`, `problemUrl`, `language`, `sourceCode`, `result` (`ACCEPTED`), `observedAt`, and `solvedAt` as ISO-8601 timestamps. `executionTime` and `memoryUsage` are optional non-negative numbers. Invalid items fail independently so valid items in the same batch remain stored.

The `(user_id, capture_id)` database constraint makes retries idempotent and prevents one user from reading another user's captures. A replay with changed core solution data is rejected; a replay can enrich missing performance fields.

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
