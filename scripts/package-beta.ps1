#requires -Version 7.0
[CmdletBinding()]
param([ValidatePattern('^[a-z0-9-]{1,24}$')][string]$BuildLabel)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Assert-NoReparse([string]$path) {
    if (Test-Path -LiteralPath $path) {
        if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing linked artifact path: $path"
        }
    }
}
function Assert-Clean {
    $status = git status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0 -or $status) { throw 'Commit changes before packaging an exact source revision.' }
}
Push-Location $repo
try {
    Assert-Clean
    $sourceCommit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot resolve source commit.' }
    $branch = (git branch --show-current).Trim()
    $nodeVersion = (node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(22|24)\.') { throw 'Use Node.js 22 or 24.' }
    $pnpmVersion = (pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '10.15.0') { throw 'Use the repository-pinned pnpm 10.15.0.' }
    if (!(Test-Path -LiteralPath 'apps/extension/node_modules')) { throw 'Prepare locked dependencies before packaging; no automatic install.' }
    foreach ($directory in @($repo, "$repo/apps", "$repo/apps/extension", "$repo/apps/extension/dist", "$repo/artifacts", "$repo/artifacts/beta")) {
        Assert-NoReparse $directory
    }
    foreach ($directory in @($repo, "$repo/apps/extension")) {
        if (Get-ChildItem -LiteralPath $directory -Force -File -Filter '.env*' | Where-Object Name -NotLike '*.example') {
            throw 'Remove local build environment overrides before producing a shared package.'
        }
    }
    if (Test-Path Env:VITE_CODEARCHIVE_API_BASE_URL) { throw 'Remove the local API build override before packaging.' }
    $manifest = Get-Content -LiteralPath 'apps/extension/public/manifest.json' -Raw | ConvertFrom-Json
    if ($manifest.version -notmatch '^\d{1,5}(\.\d{1,5}){1,3}$') { throw 'Invalid extension version for artifact naming.' }
    $name = "codearchive-beta-$($manifest.version)-$($sourceCommit.Substring(0, 12))"
    if ($BuildLabel) { $name += "-$BuildLabel" }
    $stage = Join-Path $repo "artifacts/beta/$name"
    $zip = "$stage.zip"
    foreach ($target in @($stage, $zip, "$zip.sha256")) {
        if (Test-Path -LiteralPath $target) { throw "Candidate already exists; keep it and use another -BuildLabel: $target" }
    }
    foreach ($task in @('typecheck', 'test', 'build')) {
        pnpm --filter '@codearchive/extension' $task
        if ($LASTEXITCODE -ne 0) { throw "Extension $task failed." }
    }
    node scripts/check-beta-docs.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Beta guide links failed.' }
    Assert-Clean
    if ((git rev-parse HEAD).Trim() -ne $sourceCommit) { throw 'Source revision changed during build.' }
    $dist = Join-Path $repo 'apps/extension/dist'
    $files = @(Get-ChildItem -LiteralPath $dist -Recurse -Force)
    foreach ($file in $files) {
        Assert-NoReparse $file.FullName
        if (!$file.PSIsContainer) {
            $relative = [IO.Path]::GetRelativePath($dist, $file.FullName).Replace('\', '/')
            if ($relative -notmatch '^(manifest\.json|popup\.html|archive\.html|background\.js|content/swea\.js|assets/[^/]+\.(js|css))$') {
                throw "Unexpected distribution file: $relative"
            }
        }
    }
    foreach ($required in @('manifest.json', 'popup.html', 'archive.html', 'background.js', 'content/swea.js')) {
        if (!(Test-Path -LiteralPath (Join-Path $dist $required) -PathType Leaf)) { throw "Missing built file: $required" }
    }
    if ((Get-FileHash "$dist/manifest.json").Hash -ne (Get-FileHash 'apps/extension/public/manifest.json').Hash) {
        throw 'Built manifest differs from source.'
    }
    $publicKeyHash = [Security.Cryptography.SHA256]::HashData([Convert]::FromBase64String($manifest.key))
    $idCharacters = foreach ($byte in $publicKeyHash[0..15]) { [char](97 + ($byte -shr 4)); [char](97 + ($byte -band 15)) }
    $extensionId = -join $idCharacters
    if ($extensionId -ne 'oohlcmihldmfninmdcmanddfmhoonmdl') { throw 'Extension ID changed.' }
    if (@($manifest.externally_connectable.matches).Count -ne 1 -or $manifest.externally_connectable.matches[0] -ne 'https://codearchive-dashboard-beta.onrender.com/*') {
        throw 'Unapproved Dashboard origin.'
    }
    New-Item -ItemType Directory -Path "$stage/extension", "$stage/docs" | Out-Null
    foreach ($file in $files | Where-Object { !$_.PSIsContainer }) {
        $target = Join-Path "$stage/extension" ([IO.Path]::GetRelativePath($dist, $file.FullName))
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
    foreach ($doc in @('beta-install.md', 'dashboard-beta-tester-guide.md', 'beta-troubleshooting.md',
            'beta-distribution-checklist.md', 'beta-invite-template.md', 'beta-access-design.md', 'dashboard-ai-beta-acceptance.md')) {
        Assert-NoReparse "$repo/docs/$doc"
        Copy-Item -LiteralPath "$repo/docs/$doc" -Destination "$stage/docs/$doc"
    }
    $start = @'
# CodeArchive 베타 설치 후보

운영자의 사용 가능 확인 후 설치하세요. 이 ZIP 자체는 E2E 완료·배포 승인이 아닙니다.

1. [설치·업데이트](docs/beta-install.md)를 읽고 `extension` 폴더를 Chrome에 로드합니다.
2. [사용 가이드](docs/dashboard-beta-tester-guide.md)를 따라 로컬 저장부터 확인합니다.
3. Dashboard 초대 비밀번호는 운영자가 별도로 전달합니다. 파일 안에는 없습니다.
4. [문제 해결·제보](docs/beta-troubleshooting.md)를 확인합니다.

소스 커밋·버전은 `release-info.json`, ZIP 무결성은 별도 `.zip.sha256`에서 확인하세요.
중요한 원본을 별도 보관하고 기존 Extension 제거/Chrome 저장소 초기화를 하지 마세요.
자동 동기화는 대기 기록 전체가 대상이며 AI `fake`는 실제 분석이 아닙니다.
'@
    [IO.File]::WriteAllText("$stage/README.md", $start, [Text.UTF8Encoding]::new($false))
    $hashes = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File) {
        $hashes[[IO.Path]::GetRelativePath($stage, $file.FullName).Replace('\', '/')] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $info = [ordered]@{ sourceCommit = $sourceCommit; branch = $branch; version = $manifest.version;
        extensionId = $extensionId; dashboardUrl = 'https://codearchive-dashboard-beta.onrender.com';
        generatedUtc = [DateTime]::UtcNow.ToString('o'); distributionStatus = 'candidate';
        nodeVersion = $nodeVersion; pnpmVersion = $pnpmVersion;
        checks = @('extension typecheck', 'extension tests', 'extension production build', 'manifest and file allowlist', 'beta guide links');
        sha256 = $hashes }
    [IO.File]::WriteAllText("$stage/release-info.json", ($info | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    node scripts/check-beta-docs.mjs $stage
    if ($LASTEXITCODE -ne 0) { throw 'Bundled guide links failed.' }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $expectedFiles = @(Get-ChildItem -LiteralPath $stage -Recurse -File)
        if ($archive.Entries.Count -ne $expectedFiles.Count) { throw 'ZIP entry count mismatch.' }
        foreach ($file in $expectedFiles) {
            $relative = [IO.Path]::GetRelativePath($stage, $file.FullName).Replace('\', '/')
            $entry = $archive.GetEntry($relative)
            if ($null -eq $entry) { throw "Missing ZIP entry: $relative" }
            $stream = $entry.Open()
            try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
            finally { $stream.Dispose() }
            if ($actual -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw "ZIP hash mismatch: $relative" }
        }
    } finally { $archive.Dispose() }
    $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$zip.sha256", "$zipHash  $([IO.Path]::GetFileName($zip))`n", [Text.UTF8Encoding]::new($false))
    Write-Output "Candidate: $zip"
    Write-Output "SHA-256: $zipHash"
    Write-Output 'Not uploaded, distributed, or approved for beta use.'
} finally { Pop-Location }
