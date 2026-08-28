# CodeArchive Web Dashboard

Lightweight static React + TypeScript + Vite archive shell for the current beta.

## Commands

```bash
pnpm --filter @codearchive/web typecheck
pnpm --filter @codearchive/web test
pnpm --filter @codearchive/web build
```

The production static output directory is `apps/web/dist/`.

This bootstrap intentionally uses an in-memory fixture through `DashboardArchiveDataSource`. A later bounded slice can replace that adapter with authenticated Main API data without reading Extension IndexedDB from the Web app.

The Dashboard now opens the approved exact-ID Extension Port and performs only protocol negotiation plus a metadata-only capture summary. It does not start an eligible sync session, request source-bearing pages, acknowledge records, authenticate a user, or call the Main API. Browsers without the Extension remain usable and show a retryable unavailable state.

Not implemented here: GitHub OAuth/session, automatic synchronization consent/session, source import, Main API persistence/retry, partial ACK, AI, or provider changes.
