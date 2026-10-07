# Security incident response: sensitive database error details

PostgreSQL constraint exceptions can include `Failing row contains (...)`. A
`solutions` row contains user source code, so the production profile disables
Hibernate's vendor exception logger and emits only an application-owned error
code, the validated capture UUID when available, and the request correlation ID.

## Verification

1. Run `./mvnw test` (or `mvnw.cmd test` on Windows). The safe logging test
   injects source text into a `DataIntegrityViolationException` and asserts that
   neither the source nor PostgreSQL row detail appears in captured logs or the
   HTTP error body.
2. Deploy with the `prod` profile and trigger only a non-sensitive validation
   failure. Confirm the response includes `X-Request-Id`.
3. In Render Logs, search that value (the application prefers Render's safe
   `Rndr-Id` when present). A database failure must contain
   `errorCode=DATABASE_CONSTRAINT`, `requestId`, and at most a canonical capture
   UUID. It must not contain SQL, bound values, request bodies, or source code.

## Existing log exposure

Do not copy a sensitive log line into an issue, chat, or test fixture. Restrict
workspace log access to incident responders and record the time window and
affected service without copying payload content. Render retains service logs
according to the workspace plan; the application has no API for selectively
deleting an already-ingested line. Let the provider retention period expire and
contact Render Support if an earlier provider-side purge is required. Review any
configured external log stream separately because it has its own retention and
deletion controls.

Current retention periods and the `Rndr-Id` tracing contract are maintained in
the official [Render logging documentation](https://render.com/docs/logging).
