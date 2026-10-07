# Issue #241 follow-up verification

Implemented follow-up evidence:

- Dashboard source gutters render distinct natural-number rows and its source panel exposes the existing five light and five dark Shiki themes inline. Inline selections persist immediately to the authenticated account and relay configuration, or to local storage while offline.
- The Dashboard has no runtime sample archive. When no session is available, or the authenticated solution list is unavailable, it requests the extension's capability-bound `GET_LOCAL_ARCHIVE` read-only bridge path; the route cannot ACK, upload, or start relay work.
- The extension archive persists its selected Shiki themes through an extension-page-only message. Popup controls follow the established 390px hierarchy and expose native keyboard-operable `role=switch` controls with `aria-checked`.
- SWEA retains #234's accepted-dialog, cEditor, stable capture/retry path. Canonical detail links remain validated enrichment; a query-less solving page with a single hidden identity now remains capturable.

Verification run on 2026-09-16:

```text
npm --prefix apps/dashboard test -- --run  # 52 passed
npm --prefix apps/dashboard run typecheck  # passed
npm --prefix apps/dashboard run build      # passed
npm --prefix apps/extension test -- --run  # 63 passed
npm --prefix apps/extension run typecheck  # passed
npm --prefix apps/extension run build      # passed
docker run --rm -v "${PWD}/apps/api:/workspace" -w /workspace maven:3.9-eclipse-temurin-17 ./mvnw test
  # 49 run, 5 PostgreSQL-dependent tests skipped, exit 0
git diff --check                         # passed
```

GitHub targets are read through authenticated, installation-scoped cascade endpoints. Installation authorization is bound to the immutable GitHub account ID from the App installation payload (not the mutable login), and organization installations are fail-closed until an explicit account-bound authorization flow exists. The Dashboard no longer accepts raw installation IDs or repository paths; each upper-level selection clears dependent target fields and disables automatic commits until the revised target is explicitly saved. Repository and branch endpoints carry typed `items` plus raw-source `hasMore` continuation metadata, so filtered invalid upstream entries cannot truncate bounded pagination. The API browse fixture also verifies immutable-ID filtering (including login casing), foreign-installation rejection, installation-scoped repository resolution, slash branches, unsafe-path rejection before network I/O, directory-only filtering, and unconfigured-provider fail-closed behavior. Settings target persistence uses the same immutable identity, and unauthenticated browse endpoint rejection is covered.

All Dashboard account-scoped settings, relay grant/revoke, and target-browse requests now include the immutable `X-CodeArchive-Github-Id` assertion. The API rejects a missing assertion before work and rejects a session/account mismatch before settings persistence, relay mutation, or provider browsing. Dashboard regression tests prove the rendered account ID is passed to settings/target clients; both direct and conflict-refetch inline-theme mismatches perform only null-relay cleanup, clear the live draft, and return to reconnect-required local mode. An explicit account replacement also remains local until the replacement archive read succeeds.

Settings target verification is authority-sensitive: a target change or enabled GitHub auto-commit remains provider-verified and fails closed, while an unchanged-target consent withdrawal can disable both automation flags and revoke active relay grants even when the GitHub App provider is unavailable.
