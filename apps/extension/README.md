# CodeArchive extension

This package is a standalone Manifest V3 extension build. It stores accepted
captures in IndexedDB before any dashboard interaction. Its optional automatic
download uses Chrome's `downloads` permission only after a new, non-duplicate
PASS capture is committed locally; the feature is off by default and does not
need the Dashboard, relay, or API. The extension contains no GitHub token,
cookie reader, or coding-site submitter.

## Build and test

```text
npm install
npm run build
npm test
```

The root project can invoke the same commands with `npm --prefix apps/extension`;
this package does not require a root workspace or root package script.

## Dashboard bridge

Only `https://codearchive-dashboard-beta.netlify.app` and
`http://localhost:5173` are accepted as dashboard origins. A dashboard document
must provide one exact sender origin, the same exact tab origin, a tab ID, and
Chrome document ID; lookalikes and mixed production/local sender-tab pairs are
rejected. The manifest key remains pinned to extension ID
`oohlcmihldmfninmdcmanddfmhoonmdl`.
Those same two exact dashboard URL patterns are host permissions so Chrome can
provide the external sender's tab URL; a missing tab URL remains fail-closed.
The bridge issues a short lived capability (five minute idle TTL, fifteen
minute absolute TTL) bound to that document and tab.

```text
{ type: "CONNECT" }
  -> { capability, expiresAt }

{ type: "GET_PENDING", capability, limit }
  -> { captures, hasMore }

{ type: "ACK", capability, captureIds }
  -> { ok: true }

{ type: "DISCONNECT", capability }
  -> { ok: true }
```

`GET_PENDING` is an explicit dashboard request, issues at most 50 records per
request, and does not issue the same record twice within a capability session.
An ACK containing any ID that was not issued by that session is rejected and
changes nothing. Disconnect/reconnect is the retry boundary for a page whose
sync did not complete.

The extension does not call the dashboard API. The dashboard owns bulk upsert;
after that succeeds it ACKs the issued capture IDs.

The popup shows automatic dashboard polling as disabled until a future
notification/polling handshake exists. The current dashboard's explicit “Sync
now” action remains the supported sync path. GitHub auto commit is also disabled
until a server-side target is configured.

## Platform capture boundary

The extension uses exact, platform-scoped selectors. SWEA captures only the
visible `div.popup_layer.show > div > p.txt` result whose normalized text is
the exact legacy `PASS입니다.` or the observed live `축하합니다. Pass입니다.제출이 완료되었습니다.` text (allowing whitespace between sentences). Programmers captures only the active
`#modal-dialog.modal.show[role="dialog"][aria-modal="true"]` dialog whose
`h4.modal-title` is `정답입니다!`. A result is eligible only after the exact
submit control starts a current-page attempt; stale dialogs and unchanged
historical result tables are ignored.

`mainWorld.js` is a packaged Manifest V3 `MAIN`-world script loaded at
`document_start`. It calls SWEA's `cEditor.save()` or the Programmers
CodeMirror `save()` method synchronously at the submit click, allowing the
isolated capture script to snapshot `#textSource` or `#code` at the click
boundary. It uses no inline JavaScript, extension API, network request, or
page-wide command transport. If the editor cannot be synchronized or the
source field is unavailable, the capture remains local-uncreated.

Programmers performance is optional and accepted only from the single current
`.console-content .console-test-group`: every `.result` row must be a passed
`통과 (Nms, NMB)` row, execution times are summed, and memory is averaged. A
missing or malformed optional metric never blocks the accepted source capture.

## Real-site verification status

The SWEA and Programmers selectors are isolated in their adapters and tested
against synthetic DOM fixtures. They have not been verified against live site
DOM in this environment, and site markup/editor implementations can change.
The adapters fail closed when problem metadata, editor language, source code,
the current submit attempt, or an unambiguous accepted result is unavailable.
Unsupported editor internals are left uncaptured instead of reading arbitrary
page text.
