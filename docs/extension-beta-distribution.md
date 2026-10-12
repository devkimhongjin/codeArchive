# Extension distribution

The primary public installation channel is the [CodeArchive Chrome Web Store item](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj). Chrome manages Store updates. The item ID is `mlhibjadcbklfdllkonhjjajhmhnoalj`.

An unpacked build remains for development and controlled verification. It uses the local development identity `oohlcmihldmfninmdcmanddfmhoonmdl`; do not remove an existing development extension before its local data has been checked.

## Verified release source

All extension artifacts originate from verified `master` code. The release tag must be `extension-v<release.json version>` on master's first-parent history. Package and Chrome Web Store workflows verify source, version, tests, and a key-free ZIP before any upload attempt.

The Web Store workflow waits for a successful `Verify` run on the exact master SHA. It uses short-lived workload-identity credentials and submits `DEFAULT_PUBLISH`, which can enter review. A workflow success does not mean the version is already public.

For package contents, Store metadata, and local verification steps, see [Chrome 웹스토어 배포](extension-webstore.md).

Secrets, GitHub App private keys, OAuth credentials, relay grants, and Web Store access tokens must never be included in a ZIP, release metadata, or documentation output.
