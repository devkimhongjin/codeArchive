# Extension distribution

The primary public installation channel is the [CodeArchive Chrome Web Store item](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj). Chrome manages Store updates. The item ID is `mlhibjadcbklfdllkonhjjajhmhnoalj`.

An unpacked build remains for development and controlled verification. It uses the local development identity `oohlcmihldmfninmdcmanddfmhoonmdl`; do not remove an existing development extension before its local data has been checked.

## Verified release source

All extension artifacts originate from verified `master` code. The release tag must be `extension-v<release.json version>` on master's first-parent history. Package and Chrome Web Store workflows verify source, version, tests, and a key-free ZIP before any upload attempt.

The Web Store workflow runs manually from `master` with dry run enabled by default; release tags do not trigger Store submissions. Automatic submission and scheduled publication have been cancelled. For an explicitly requested submission, it waits for a successful `Verify` run on the exact master SHA, uses short-lived workload-identity credentials and submits `STAGED_PUBLISH`, which enters review and then waits in `STAGED` until the owner publishes it from the Developer Dashboard. A workflow success does not mean the version is already public.

For package contents, Store metadata, and local verification steps, see [Chrome 웹스토어 배포](extension-webstore.md).

Secrets, GitHub App private keys, OAuth credentials, relay grants, and Web Store access tokens must never be included in a ZIP, release metadata, or documentation output.
