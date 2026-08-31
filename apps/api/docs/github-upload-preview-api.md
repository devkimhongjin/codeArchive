# Single-solution upload preview — #44, slice 3

Builds on [repository browsing](github-repository-browse-api.md). Changes only `apps/api/**`.
The separately gated [explicit single-commit API](github-single-commit-api.md) adds a distinct confirmation flow.
This slice is read-only: no source transmission to GitHub, file/branch/commit creation, overwrite,
DB mutation/migration, preview persistence, Dashboard UI, permission provisioning or deployment.
Both existing App integration and Contents-read configuration gates remain disabled by default.
Real App installation, secrets, read grants, runtime enablement and beta deployment still require
their own explicit approval. Contents-write is never requested by this implementation.

## Request and authorization

`POST /api/v1/integrations/github/upload-preview`

Uses the existing authenticated CodeArchive session. A cookie-authenticated POST requires the
configured exact Dashboard Origin. Mixed cookie/bearer credentials are rejected. The legacy
bearer API remains unchanged; no auth scopes, bridge contract or allowed origins change.

JSON body (IDs in requests may be decimal strings or JSON integers within positive signed 64-bit range):

```json
{
  "solutionId": "00000000-0000-0000-0000-000000000001",
  "expectedUpdatedAt": "2026-08-30T01:00:00Z",
  "installationId": "701",
  "repositoryId": "801",
  "branch": "main",
  "expectedCommitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "path": "SWEA/1206/Solution.java",
  "commitMessage": "Add SWEA 1206 solution"
}
```

Only `path` and `commitMessage` are optional/null. The client supplies the current archive
`updatedAt` and branch-selection `commitSha`; it cannot supply source, owner, capture provenance,
repository URL, tree/blob SHA, overwrite authorization or a publication decision. Unknown JSON
properties are ignored by the existing mapper; they do not affect the server's source or decisions.
The sample is synthetic and grants no access.

The source is read atomically with `WHERE id = ? AND user_id = currentSessionUser`. Missing and
other-user sources both return 404 `SOLUTION_NOT_FOUND`, without a GitHub call. Only records with
server `accepted_capture=true` and `result=ACCEPTED` qualify. This is the existing browser-observed
capture provenance, not independent official-judge verification. Manual ACCEPTED records and
edited captures do not qualify; the existing V7 trigger invalidates changed code/provenance fields.
Community publication is neither required nor enabled: one's own private capture is eligible.

Installation ownership is freshly resolved against the authenticated user's immutable GitHub ID.
Only that personal User installation and its single selected, owned repository are allowed.
The provider client uses exactly `metadata:read` + `contents:read`, restricted to that repository.
Normal GitHub login credentials are not reused for repository access.

## Source, output and snapshot rules

- A fresh JDBC source snapshot is taken before network I/O and compared after it. A changed version,
  code, eligibility, source identity or deletion invalidates the result with 409
  `GITHUB_PREVIEW_SOURCE_CHANGED`, with no source/diff in the error. No database transaction or row
  lock is held across GitHub calls. This is not a lock against changes after the final read.
- Only raw saved code is proposed, preserving whitespace, line endings and Unicode as UTF-8.
  Titles, problem statements, performance notes, AI artifacts and export-copy formatting are not appended.
  Code must be nonblank and at most 1 MiB of UTF-8 bytes; the existing archive input limit is tighter.
- Default path is `{platform}/{problemNumber}/Solution.{extension}`. Extension mapping matches existing
  local export: Java `.java`, Python `.py`, JavaScript `.js`, TypeScript `.ts`, C++ `.cpp`, other `.txt`.
  A custom path must have the matching extension; it is validated, not normalized.
- Output path: relative, at most 1024 UTF-8 bytes, 8 parent folders plus filename, 255 bytes per segment.
  Inherits browsing exclusions (traversal, empty/dot/dot-dot, `.git`, absolute/backslash/colon/percent,
  control/format/bidi, wildcard/quote/angle-bracket/pipe, trailing dot/space), additionally rejects
  `.github` anywhere and DOS device names. Unicode/internal spaces are supported.
- Default commit message is `Add {platform} {problemNumber} solution`; custom text must be nonblank,
  at most 200 UTF-8 bytes and one line with no control/format characters. It is never sent to GitHub here.
- Resolve the current branch by literal name and require its SHA to equal `expectedCommitSha`.
  Resolve the root and parent trees only by provider-returned SHAs, non-recursively. Branch protection
  metadata must be present. Only complete, bounded trees establish absence.
- Missing parent folders can be planned once a complete ancestor proves absence. No placeholder
  files are created. Files/symlinks/submodules obstruct traversal and are never followed.
- An existing target of any type blocks creation, even if its remote bytes might match. No blob,
  remote source or overwrite diff is fetched. Protected branches also block, regardless of potential
  user bypass privileges. `protected=false` does not assert future write permission or ruleset compliance.
- Empty repositories without a selected existing branch are not bootstrapped. Provider 404/409,
  truncation or malformed trees never become an empty successful target.

At most 9 trees plus installation/token/repository/branch resolution are fetched. Existing 5s connect/
10s read per-call timeouts apply with no retry; sequential deep-path reads can take longer than 10s.
Future UI must avoid request storms and discard late responses after account/selection changes.

## Response

Normal `{success,data,error,requestId}` envelope, `Cache-Control: no-store, private`, and
Origin/Cookie/Authorization in Vary. Repository and installation IDs are decimal strings in responses.

`data` contains:

- `status`: `CREATE_PREVIEW` or `BLOCKED`; `readOnly=true`, `uploadEnabled=false` in both cases.
- `source`: id, platform, problemNumber, language, updatedAt — only the authenticated owner's source metadata.
- `target`: installationId, repositoryId, fullName, privateRepository, branch, commitSha, rootTreeSha,
  protectedBranch, path, missingDirectories, existingEntry, obstruction. Entry metadata is only name,
  path, type, SHA and browsable, never provider URLs or file content.
- `file`: path, encoding=`UTF-8`, byteLength, SHA-256 of the exact proposed source bytes.
- `commitMessage`: reviewed candidate text; no commit operation takes place.
- `diff`: `{operation:"ADD_FILE",before:"",after:<exact saved code>}` only for `CREATE_PREVIEW`;
  null for `BLOCKED`. This is a new-file content comparison, not a remote overwrite/unified patch.
- `blockers`: any of `PROTECTED_BRANCH`, `PARENT_NOT_DIRECTORY`, `PATH_EXISTS`.
- `disclosureNotice`: warns about repository readers for private repositories and public visibility
  for public repositories. Both require separate confirmation for a future actual upload.

Eligibility errors use 403 `GITHUB_PREVIEW_NOT_ELIGIBLE`; malformed input is 400 `INVALID_REQUEST`.
Existing safe provider errors, branch-change 409, incomplete-tree 422, auth 401 and configuration 503
remain unchanged. Error responses/logging do not include source or provider credentials/messages.
Source-bearing request, snapshot, diff and preview diagnostics are redacted.

## Verification and next boundary

Mock HTTP tests exercise exact token scope, fixed GET endpoints, slash branches/Unicode folders,
missing-parent plans, all collision types, protected branches, stale heads, incomplete trees,
unavailable repositories, disabled configuration and repository-owner mismatch. Strict expectations
allow only token creation plus metadata reads, no blob/source/write endpoint.

PostgreSQL Testcontainers + full Spring security/MVC tests create captures through actual bulk-upsert,
then verify private ownership/provenance, exact source bytes/digest, repeated read-only requests,
forged client properties, unchanged archive publication state, edits/deletion during network I/O,
collision blocking, public disclosure, installation ownership, cookie Origin and input failures.
No live GitHub App E2E is claimed; Java 21 full API CI is required before merge.

There is no executable preview token and this response is not upload authorization. A future single
commit slice must bind separate user consent to reviewed source bytes/version, repository privacy,
path, message and branch, then freshly validate session, installation/repository ownership, source,
head and collision before an atomic create-only write. Source edits, changed privacy, branch movement,
permission loss and retry/ambiguous outcomes must fail safely. Dashboard UI, explicit disclosure
confirmation, actual Contents-write grant, empty-repository initialization and batch uploads remain
separate work. This API alone does not complete #44.
