# Extension beta distribution

CodeArchive beta distributes a verified ZIP through GitHub Releases. It does **not** attempt silent installation, registry changes, security-warning bypasses, or a website-triggered CRX install.

Chrome's supported model matters here:

- An unpacked extension is suitable for trusted development and beta testing.
- Direct installation for general Windows and macOS users requires the Chrome Web Store. Self-hosted installs are limited to managed enterprise policy; Linux has additional self-hosting options.
- CodeArchive therefore uses an explicit ZIP download and Chrome developer-mode load until an unlisted/private Web Store release is approved.

Official references:

- <https://developer.chrome.com/docs/extensions/how-to/distribute>
- <https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux>
- <https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions>

## Install the beta ZIP

1. Open the Dashboard **연동 가이드** and download `codearchive-extension.zip` from the newest compatible GitHub prerelease.
2. Compare the downloaded file's SHA-256 with both the value shown in the Dashboard and `codearchive-extension.zip.sha256` in the release.
   - PowerShell: `Get-FileHash .\codearchive-extension.zip -Algorithm SHA256`
   - macOS/Linux: `shasum -a 256 codearchive-extension.zip`
3. Extract the ZIP to a stable folder that will not be automatically cleaned.
4. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
5. Select the extracted folder. Confirm extension ID `oohlcmihldmfninmdcmanddfmhoonmdl`, the release version, and the requested permissions.
6. Open the Dashboard and confirm that its status bar reports the extension version and connection state.

The ZIP contains the contents of `apps/extension/dist` at its root. Selecting the ZIP itself or the parent folder will not work.

## Update without losing local captures

Do not remove the installed extension. Removing it can also remove extension-owned browser storage.

1. Download and verify the new ZIP.
2. Close CodeArchive extension pages and replace the files inside the existing extracted folder with the new ZIP contents.
3. Open `chrome://extensions` and press **Reload** on CodeArchive.
4. Confirm that the ID is unchanged, the new version appears, and the local archive still contains the previous captures.
5. Submit one disposable accepted solution and verify local save and synchronization before relying on the update.

The public manifest key pins the extension ID, and IndexedDB upgrades are forward migrations. Rollback is therefore an emergency procedure, not a routine update path: use a compatible artifact from the GitHub Releases history, never replace the manifest key, and do not assume a newer storage schema can be downgraded.

## Release artifacts and trust boundary

`.github/workflows/extension-release.yml` performs the release build from a source commit, runs the extension test suite, and produces three immutable artifacts:

- `codearchive-extension.zip`
- `codearchive-extension.zip.sha256`
- `codearchive-extension-metadata.json`

The metadata binds the ZIP digest to its source commit, version, fixed extension ID, minimum Chrome version, and Dashboard/API compatibility floor. The workflow also embeds it in a machine-readable GitHub Release note. The Dashboard accepts only the pinned repository, tag and asset names, fixed schema and extension ID, then compares the ZIP asset's GitHub-provided SHA-256 digest before showing a download. It does not trust download URLs from release metadata.

The workflow can run without publishing to inspect its Actions artifact. Publishing creates a prerelease tag named `extension-v<release.json version>` and refuses to replace an existing release. Keep historical prereleases available for incident review and controlled rollback.

## Release operator checklist

1. Update `release.json`; keep the Dashboard package, extension package, and manifest versions equal.
2. Merge the verified change to `develop`.
3. Run **Extension beta package** with `publish=false` and inspect the ZIP, metadata, and checksum artifact.
4. Load the ZIP as an unpacked extension over the existing beta installation and complete the local-data update check above.
5. Only after that manual check, run the workflow from the intended release commit with `publish=true` (or push the matching `extension-v<version>` tag).
6. Verify the Dashboard's newest-compatible-release card before promoting any Dashboard deployment.

Secrets, the GitHub App private key, OAuth credentials, and relay credentials must never be included in the ZIP or release metadata.
