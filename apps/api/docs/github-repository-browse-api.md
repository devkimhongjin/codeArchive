# GitHub repository browsing — #44, slice 2

Builds on [installation/repository reads](github-installation-read-api.md).
Only apps/api changes; no UI, source upload, branch creation, persistence, permission provisioning,
runtime enablement, deployment, or ordinary OAuth scope changes.

## Authorization

The existing authenticated CodeArchive session resolves the installation owner on every request.
Only a personal installation owned by the server user's immutable GitHub ID is allowed.
The client chooses a numeric installation/repository ID, not an owner/repository URL.

After ownership validation, the server mints a token with exactly metadata:read + contents:read,
restricted by repository_ids to the single selected repository. It then resolves the accessible
repository list with that token, requiring exactly one repository and matching ID/owner/type.
Only this verified server owner/name is used to construct subsequent fixed-host GitHub URLs.
Other owners, removed/revoked access, and organization installations/repositories fail closed.
Renaming the same owned repository is supported through ID resolution; redirects during browsing
are rejected, and a transfer to another owner cannot inherit the previous access.
No cached selection or token survives requests/accounts.

The existing metadata-only repository list remains metadata-only. Its token parser now accepts
GitHub's newer opaque installation JWT format, including periods/hyphens; neither token format is decoded.

## Configuration gate

GITHUB_APP_CONTENTS_READ_ENABLED defaults to false, separately from GITHUB_APP_INTEGRATION_ENABLED.
The existing installation ownership lookup may run, but no contents token is minted or repository
contents metadata read until both integration configuration and the contents-read gate permit it.
This change does not set any provider environment variable, install an App, or grant permissions.
Before real use, the owner must approve the exact App/installation/repository, Contents read grant,
secret configuration, both feature flags, and exact beta deployment. No Contents write is requested.

## Endpoints

Base: /api/v1/integrations/github/installations/{installationId}/repositories/{repositoryId}

Both endpoints use the normal {success,data,error,requestId} envelope, decimal string IDs in responses,
and private/no-store with Origin/Cookie/Authorization Vary headers.

### GET /branches?page=1

Data:
`{installationId,repositoryId,branches:[{name,commitSha,protected,selectable}],page,perPage:30,hasMore}`

Page must be 1–10000. Empty arrays are successful (including a new repository with no branches).
hasMore uses GitHub Link metadata; the URL is never followed. Unsupported branch names remain
visible with selectable=false. A protected flag is informational, not an assertion of write access.

### GET /tree?branch=main&expectedCommitSha=<40 lowercase hex>&path=

The branch and expectedCommitSha are required. Use the commitSha from branch selection.
Omitted/empty path means root. Data:

`{installationId,repositoryId,branch,commitSha,rootTreeSha,treeSha,path,parentPath,breadcrumbs:[{name,path}],entries:[{name,path,type,sha,browsable}],truncated:false}`

The branch is resolved by its literal encoded name (including slash names), and its current commit
must match expectedCommitSha. A mismatch is 409 GITHUB_REFERENCE_CHANGED before any tree is read.
The root tree SHA comes from that verified branch response. Each path segment is resolved against
its parent tree; subsequent requests use only returned tree SHAs. Arbitrary client tree/blob SHAs,
provider URLs, contents URLs, and recursive traversal are never used.

All entries within the response belong to that commit snapshot. The branch can still move after
resolution; future preview/commit must revalidate the head and collision state. This is not a write lock.

Breadcrumb root is {name:"/",path:""}; parentPath is null for root, "" for a root child.
Types are DIRECTORY, FILE, SYMLINK, SUBMODULE. Only safe DIRECTORY entries are browsable.
Symlinks/submodules are displayed but never followed; file blobs/downloads/diffs are never fetched.
An empty complete tree is successful. A missing path or a non-directory path is 404 GITHUB_PATH_NOT_FOUND.
No placeholder is created for an empty/new folder.

## Bounds and validation

- Repository/installation IDs: positive signed 64-bit integers.
- Branch: maximum 255 UTF-8 bytes; conservative Git branch syntax, no traversal/ref operators,
  wildcard/control/format/whitespace/backslash/percent encodings. Unsupported values are rejected, not normalized.
- Path: relative, at most 1024 UTF-8 bytes, 8 segments, 255 bytes per segment.
  Reject leading/trailing/double slash, dot/dot-dot, .git, backslash, colon, percent encodings,
  control/format characters, wildcard/quote/angle-bracket/pipe, trailing dot/space.
  Unicode and internal spaces are supported. Returned unsupported directory names are not browsable.
  This is browsing validation; future new-file output validation remains a separate contract.
- Tree: non-recursive (recursive parameter omitted), at most 1000 entries per directory.
  Truncated/oversized root or child returns 422 GITHUB_DIRECTORY_LIMIT_EXCEEDED with no partial data.
  Missing truncation metadata, duplicate names, invalid SHA/type/mode, or mismatched tree SHA is 502.
- A path request fetches at most 9 trees plus installation/token/repository/branch resolution.
  Per-request network timeouts remain 5s connect/10s read; no automatic retry or unbounded traversal.
  Deep path resolution is sequential and can exceed one provider-call timeout. Future UI must allow
  cancellation, avoid request storms, and discard late responses after account/selection changes.

## Safe failures / verification

Existing 401 session, 503 disabled/provider credentials, 403 permission, 404 provider missing,
429 rate limit, and 502 invalid/upstream responses remain safe and never clear the CodeArchive session.
Provider 409 becomes GITHUB_REPOSITORY_STATE_UNAVAILABLE (empty/unavailable state), not a fabricated
empty directory. Provider 422 remains a safe 502 because it can represent permission/validation/abuse
rejection; raw provider messages are not used to infer availability.

Mock HTTP tests cover exact single-repository read scope, token format, owner/ID/count mismatch,
protected/paginated/empty branches, slash/Unicode paths, commit snapshots, missing paths,
symlink/submodule exclusion, incomplete/oversized/malformed trees and safe status handling.
Mock MVC runs the existing security filter/service and checks authorization, current server owner,
breadcrumbs, validation before provider calls, and no partial data on failure.
Full Java 21/PostgreSQL Testcontainers API CI is required. No real GitHub App E2E is claimed.

Official references:
[branches](https://docs.github.com/en/rest/branches/branches),
[trees](https://docs.github.com/en/rest/git/trees#get-a-tree),
[installation token scoping and format](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
