[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$workerSource = Join-Path $PSScriptRoot 'deploy-issue247-worker.ps1'
$apiSource = Join-Path $PSScriptRoot 'deploy-issue248-api.ps1'
$preflightSource = Join-Path $PSScriptRoot 'staging-db-preflight.mjs'
$blockedPolicySource = Join-Path $PSScriptRoot 'staging-db-policy.json'
$workflowSource = Join-Path $repoRoot '.github/workflows/deploy-gcp-staging.yml'

foreach ($required in @($workerSource, $apiSource, $preflightSource, $blockedPolicySource, $workflowSource)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required integration input is missing: $([IO.Path]::GetFileName($required))"
    }
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "codearchive-staging-preflight-$([Guid]::NewGuid().ToString('N'))"
$binDir = Join-Path $tempRoot 'bin with spaces'
$fixtureDir = Join-Path $tempRoot 'fixture'
$mutationLog = Join-Path $tempRoot 'mutations.log'
$commandLog = Join-Path $tempRoot 'commands.log'
New-Item -ItemType Directory -Path $binDir, $fixtureDir -Force | Out-Null
New-Item -ItemType File -Path $mutationLog, $commandLog -Force | Out-Null

function Write-SyntheticPolicy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [ValidateSet('verified-safe', 'worker-production', 'canonical-mismatch', 'unverified')]
        [string]$Mode
    )

    if ($Mode -eq 'unverified') {
        Copy-Item -LiteralPath $blockedPolicySource -Destination $Path -Force
        return
    }

    $workerRole = if ($Mode -eq 'worker-production') { 'production' } else { 'nonproduction' }
    $workerAlias = if ($Mode -eq 'canonical-mismatch') { 'synthetic-worker-isolated' } else { 'synthetic-isolated' }
    $policy = [ordered]@{
        schemaVersion = 1
        inventoryStatus = 'verified'
        reviewedAt = '2026-09-21T00:00:00Z'
        validUntil = '2099-12-31T00:00:00Z'
        services = @(
            [ordered]@{
                project = 'synthetic-project'
                region = 'asia-southeast1'
                service = 'codearchive-api-stg'
                role = 'nonproduction'
                datasourceAlias = 'synthetic-isolated'
                evidence = 'synthetic:integration-api'
                springProfile = 'prod'
            },
            [ordered]@{
                project = 'synthetic-project'
                region = 'asia-southeast1'
                service = 'codearchive-github-worker-stg'
                role = $workerRole
                datasourceAlias = $workerAlias
                evidence = 'synthetic:integration-worker'
                springProfile = 'prod'
            }
        )
        datasourceAliases = @(
            [ordered]@{
                alias = 'synthetic-isolated'
                canonicalDatabaseId = 'neon:synthetic:isolated:codearchive:codearchive_v2'
                evidence = 'synthetic:integration-datasource'
                secretVersions = [ordered]@{
                    url = [ordered]@{ name = 'codearchive-spring-datasource-url'; version = '7' }
                    username = [ordered]@{ name = 'codearchive-spring-datasource-username'; version = '7' }
                    password = [ordered]@{ name = 'codearchive-spring-datasource-password'; version = '7' }
                }
            },
            [ordered]@{
                alias = 'synthetic-worker-isolated'
                canonicalDatabaseId = 'neon:synthetic:worker-isolated:codearchive:codearchive_v2'
                evidence = 'synthetic:integration-worker-datasource'
                secretVersions = [ordered]@{
                    url = [ordered]@{ name = 'codearchive-spring-datasource-url'; version = '7' }
                    username = [ordered]@{ name = 'codearchive-spring-datasource-username'; version = '7' }
                    password = [ordered]@{ name = 'codearchive-spring-datasource-password'; version = '7' }
                }
            }
        )
        approvedNonproductionDatabases = @(
            [ordered]@{
                canonicalDatabaseId = 'neon:synthetic:isolated:codearchive:codearchive_v2'
                evidence = 'synthetic:integration-approved-database'
            },
            [ordered]@{
                canonicalDatabaseId = 'neon:synthetic:worker-isolated:codearchive:codearchive_v2'
                evidence = 'synthetic:integration-approved-worker-database'
            }
        )
        protectedProductionDatabases = @('neon:production:main:codearchive:codearchive_v2')
    }
    $policy | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}

$fakeGcloudMjs = Join-Path $binDir 'fake-gcloud.mjs'
@'
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const line = args.join(' ');
appendFileSync(process.env.FAKE_COMMAND_LOG, `gcloud ${line}\n`);
const mutation = /^(?:services enable |artifacts repositories (?:create|set-cleanup-policies) |run deploy |run services (?:update |add-iam-policy-binding |update-traffic )|tasks create-http-task )/.test(line);
if (mutation) {
  appendFileSync(process.env.FAKE_MUTATION_LOG, `gcloud ${line}\n`);
  if (process.env.FAKE_GCLOUD_SCENARIO !== 'allow-success') {
    process.stderr.write('FAKE_MUTATION_MUST_NOT_RUN\n');
    process.exit(88);
  }
}
if (process.env.FAKE_GCLOUD_SCENARIO === 'provider-fail'
    && /^run services describe codearchive-api-stg .*--format=json$/.test(line)) {
  process.stderr.write('SENTINEL_PASSWORD SENTINEL_TOKEN SENTINEL_SOURCE\n');
  process.exit(41);
}
const serviceMatch = line.match(/^run services describe (codearchive-api-stg|codearchive-github-worker-stg) .*--format=json$/);
if (serviceMatch) {
  const container = { env: [
    { name: 'SPRING_PROFILES_ACTIVE', value: 'prod' },
    { name: 'SPRING_DATASOURCE_URL', valueFrom: { secretKeyRef: { name: 'codearchive-spring-datasource-url', key: 'latest' } } },
    { name: 'SPRING_DATASOURCE_USERNAME', valueFrom: { secretKeyRef: { name: 'codearchive-spring-datasource-username', key: 'latest' } } },
    { name: 'SPRING_DATASOURCE_PASSWORD', valueFrom: { secretKeyRef: { name: 'codearchive-spring-datasource-password', key: 'latest' } } },
  ] };
  if (process.env.FAKE_GCLOUD_SCENARIO === 'command-override') {
    container.args = ['--spring.config.import=optional:file:/synthetic-override.yml'];
  }
  if (process.env.FAKE_GCLOUD_SCENARIO === 'datasource-override') {
    container.env.push({ name: 'SPRING_DATASOURCE_HIKARI_JDBCURL', value: 'SENTINEL_SOURCE' });
  }
  const template = { spec: { containers: [container] } };
  if (process.env.FAKE_GCLOUD_SCENARIO === 'cross-project-mapping') {
    template.metadata = { annotations: { 'run.googleapis.com/secrets': [
      'codearchive-spring-datasource-url:projects/other-project/secrets/codearchive-spring-datasource-url',
      'codearchive-spring-datasource-username:projects/other-project/secrets/codearchive-spring-datasource-username',
      'codearchive-spring-datasource-password:projects/other-project/secrets/codearchive-spring-datasource-password',
    ].join(',') } };
  }
  process.stdout.write(`${JSON.stringify({ spec: { template } })}\n`);
  process.exit(0);
}
const versionMatch = line.match(/^secrets versions describe (latest|[1-9][0-9]*) --secret=([^ ]+) --project=synthetic-project --format=json$/);
if (versionMatch) {
  const version = versionMatch[1] === 'latest' ? '7' : versionMatch[1];
  process.stdout.write(`${JSON.stringify({ name: `projects/synthetic-project/secrets/${versionMatch[2]}/versions/${version}`, state: 'ENABLED' })}\n`);
  process.exit(0);
}
if (/^projects describe /.test(line)) process.stdout.write('synthetic-project\n');
else if (/^secrets describe ([^ ]+) /.test(line)) process.stdout.write(`${line.match(/^secrets describe ([^ ]+) /)[1]}\n`);
else if (/^artifacts docker images describe /.test(line)) process.stdout.write(`sha256:${'a'.repeat(64)}\n`);
else if (/^auth print-access-token$/.test(line)) process.stdout.write('synthetic-access-token\n');
else if (/^run services describe codearchive-github-worker-stg .*format=value\(status.url\)/.test(line)) process.stdout.write('https://synthetic-worker.invalid\n');
else if (/^run services describe codearchive-api-stg .*format=value\(status.url\)/.test(line)) process.stdout.write('https://synthetic-api.invalid\n');
else if (/^run services describe codearchive-api-stg .*format=value\(metadata.name\)/.test(line)) process.stdout.write('codearchive-api-stg\n');
else if (/^run services describe codearchive-api-stg .*format=value\(status.latestReadyRevisionName\)/.test(line)) process.stdout.write('codearchive-api-stg-00001-syn\n');
'@ | Set-Content -LiteralPath $fakeGcloudMjs -Encoding utf8NoBOM

$fakeDockerMjs = Join-Path $binDir 'fake-docker.mjs'
@'
import { appendFileSync } from 'node:fs';
const line = process.argv.slice(2).join(' ');
appendFileSync(process.env.FAKE_COMMAND_LOG, `docker ${line}\n`);
appendFileSync(process.env.FAKE_MUTATION_LOG, `docker ${line}\n`);
if (process.env.FAKE_GCLOUD_SCENARIO === 'allow-success') process.exit(0);
process.stderr.write('FAKE_DOCKER_MUST_NOT_RUN\n');
process.exit(89);
'@ | Set-Content -LiteralPath $fakeDockerMjs -Encoding utf8NoBOM

if ($IsWindows) {
    "& node '$fakeGcloudMjs' @args`r`nexit `$LASTEXITCODE`r`n" | Set-Content -LiteralPath (Join-Path $binDir 'gcloud.ps1') -Encoding utf8NoBOM
    "@echo off`r`nnode `"$fakeDockerMjs`" %*`r`nexit /b %ERRORLEVEL%`r`n" | Set-Content -LiteralPath (Join-Path $binDir 'docker.cmd') -Encoding ascii
} else {
    $gcloudWrapper = Join-Path $binDir 'gcloud'
    $dockerWrapper = Join-Path $binDir 'docker'
    @"
#!/usr/bin/env bash
exec node '$fakeGcloudMjs' "`$@"
"@ | Set-Content -LiteralPath $gcloudWrapper -Encoding utf8NoBOM
    @"
#!/usr/bin/env bash
exec node '$fakeDockerMjs' "`$@"
"@ | Set-Content -LiteralPath $dockerWrapper -Encoding utf8NoBOM
    chmod +x $gcloudWrapper $dockerWrapper
}

$oldPath = $env:PATH
$env:PATH = "$binDir$([IO.Path]::PathSeparator)$oldPath"
$env:FAKE_MUTATION_LOG = $mutationLog
$env:FAKE_COMMAND_LOG = $commandLog

function Reset-FakeLogs {
    Clear-Content -LiteralPath $mutationLog
    Clear-Content -LiteralPath $commandLog
}

function Assert-NoMutation {
    $entries = @(Get-Content -LiteralPath $mutationLog -ErrorAction SilentlyContinue | Where-Object { $_ -and $_.Trim() })
    if ($entries.Count -ne 0) {
        throw "Expected zero mutation calls, observed: $($entries -join '; ')"
    }
}

function Assert-PinnedDatasourceDeploy {
    param([Parameter(Mandatory = $true)] [string]$Service)

    $deploys = @(Get-Content -LiteralPath $commandLog | Where-Object { $_ -match "^gcloud run deploy $([regex]::Escape($Service)) " })
    if ($deploys.Count -ne 1) {
        throw "Expected one fake deploy for $Service, observed $($deploys.Count)."
    }
    $deploy = $deploys[0]
    foreach ($binding in @(
        'SPRING_DATASOURCE_URL=codearchive-spring-datasource-url:7',
        'SPRING_DATASOURCE_USERNAME=codearchive-spring-datasource-username:7',
        'SPRING_DATASOURCE_PASSWORD=codearchive-spring-datasource-password:7'
    )) {
        if ($deploy -notmatch [regex]::Escape($binding)) {
            throw "Fake deploy for $Service omitted a checked numeric datasource binding."
        }
    }
    if ($deploy -match 'SPRING_DATASOURCE_(?:URL|USERNAME|PASSWORD)=[^, ]+:latest') {
        throw "Fake deploy for $Service used mutable latest for a datasource binding."
    }
}

function Invoke-EntryPoint {
    param(
        [Parameter(Mandatory = $true)] [string]$Script,
        [Parameter(Mandatory = $true)] [string]$PolicyMode,
        [Parameter(Mandatory = $true)] [string]$Scenario,
        [Parameter(Mandatory = $true)] [string[]]$Arguments,
        [string]$HostExecutable = 'pwsh'
    )

    Copy-Item -LiteralPath $workerSource -Destination (Join-Path $fixtureDir 'deploy-issue247-worker.ps1') -Force
    Copy-Item -LiteralPath $apiSource -Destination (Join-Path $fixtureDir 'deploy-issue248-api.ps1') -Force
    Copy-Item -LiteralPath $preflightSource -Destination (Join-Path $fixtureDir 'staging-db-preflight.mjs') -Force
    Write-SyntheticPolicy -Path (Join-Path $fixtureDir 'staging-db-policy.json') -Mode $PolicyMode

    Reset-FakeLogs
    $env:FAKE_GCLOUD_SCENARIO = $Scenario
    $scriptPath = Join-Path $fixtureDir $Script
    $outputPath = Join-Path $tempRoot "output-$([Guid]::NewGuid().ToString('N')).txt"
    Push-Location $repoRoot
    try {
        & $HostExecutable -NoProfile -File $scriptPath @Arguments *> $outputPath
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $output = Get-Content -LiteralPath $outputPath -Raw
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

try {
    $workflow = Get-Content -LiteralPath $workflowSource -Raw
    $workflowPreflight = $workflow.IndexOf('node infra/gcp/staging-db-preflight.mjs prepare', [StringComparison]::Ordinal)
    $workflowDockerAuth = $workflow.IndexOf('gcloud auth configure-docker', [StringComparison]::Ordinal)
    $workflowBuild = $workflow.IndexOf('docker build', [StringComparison]::Ordinal)
    $workflowDeploy = $workflow.IndexOf('gcloud run deploy', [StringComparison]::Ordinal)
    if ($workflowPreflight -lt 0 -or $workflowDockerAuth -lt 0 -or $workflowBuild -lt 0 -or $workflowDeploy -lt 0 -or $workflowPreflight -ge $workflowDockerAuth -or $workflowPreflight -ge $workflowBuild -or $workflowPreflight -ge $workflowDeploy) {
        throw 'Workflow database preflight must run before Docker authentication, build/push, and Cloud Run deployment.'
    }

    $workerPlan = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project')
    if ($workerPlan.ExitCode -ne 0) {
        $safeReason = [regex]::Match($workerPlan.Output, 'STAGING_DB_PREFLIGHT_DENY [A-Z0-9_]+(?: [A-Za-z0-9._:-]+)?').Value
        $suffix = if ($safeReason) { " ($safeReason)" } else { '' }
        throw "Worker entrypoint rejected a verified synthetic plan.$suffix"
    }
    if ($workerPlan.Output -notmatch 'DatabasePreflightFingerprint') { throw 'Worker plan omitted the preflight fingerprint.' }
    Assert-NoMutation

    $apiPlan = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)))
    if ($apiPlan.ExitCode -ne 0) {
        $safeReason = [regex]::Match($apiPlan.Output, 'STAGING_DB_PREFLIGHT_DENY [A-Z0-9_]+(?: [A-Za-z0-9._:-]+)?').Value
        $suffix = if ($safeReason) { " ($safeReason)" } else { '' }
        throw "API entrypoint rejected a verified synthetic plan.$suffix"
    }
    if ($apiPlan.Output -notmatch 'DatabasePreflightFingerprint') { throw 'API plan omitted the preflight fingerprint.' }
    Assert-NoMutation

    if ($env:OS -eq 'Windows_NT') {
        $windowsPowerShellWorkerPlan = Invoke-EntryPoint `
            -Script 'deploy-issue247-worker.ps1' `
            -PolicyMode 'verified-safe' `
            -Scenario 'normal' `
            -Arguments @('-ProjectId', 'synthetic-project') `
            -HostExecutable 'powershell.exe'
        if ($windowsPowerShellWorkerPlan.ExitCode -ne 0) { throw 'Worker entrypoint failed under Windows PowerShell 5.1.' }
        if ($windowsPowerShellWorkerPlan.Output -notmatch 'DatabasePreflightFingerprint') { throw 'Windows PowerShell worker plan omitted the preflight fingerprint.' }
        Assert-NoMutation

        $windowsPowerShellApiPlan = Invoke-EntryPoint `
            -Script 'deploy-issue248-api.ps1' `
            -PolicyMode 'verified-safe' `
            -Scenario 'normal' `
            -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64))) `
            -HostExecutable 'powershell.exe'
        if ($windowsPowerShellApiPlan.ExitCode -ne 0) { throw 'API entrypoint failed under Windows PowerShell 5.1.' }
        if ($windowsPowerShellApiPlan.Output -notmatch 'DatabasePreflightFingerprint') { throw 'Windows PowerShell API plan omitted the preflight fingerprint.' }
        Assert-NoMutation
    }

    $workerApplied = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'allow-success' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply', '-SkipBuild', '-SkipSmokeTest')
    if ($workerApplied.ExitCode -ne 0) { throw 'Worker entrypoint rejected a fake verified apply.' }
    Assert-PinnedDatasourceDeploy -Service 'codearchive-github-worker-stg'

    $apiApplied = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'allow-success' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply', '-SkipSmokeTest')
    if ($apiApplied.ExitCode -ne 0) { throw 'API entrypoint rejected a fake verified apply.' }
    Assert-PinnedDatasourceDeploy -Service 'codearchive-api-stg'

    $workerWhatIf = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply', '-WhatIf')
    if ($workerWhatIf.ExitCode -ne 0) { throw 'Worker WhatIf rejected a verified synthetic plan.' }
    Assert-NoMutation

    $apiWhatIf = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply', '-WhatIf')
    if ($apiWhatIf.ExitCode -ne 0) { throw 'API WhatIf rejected a verified synthetic plan.' }
    Assert-NoMutation

    $workerDenied = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'worker-production' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply')
    if ($workerDenied.ExitCode -eq 0) { throw 'Worker entrypoint unexpectedly passed a production-role target.' }
    Assert-NoMutation

    $apiDenied = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'worker-production' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply')
    if ($apiDenied.ExitCode -eq 0) { throw 'API entrypoint unexpectedly passed when the paired worker target was production.' }
    Assert-NoMutation

    $workerPairMismatch = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'canonical-mismatch' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply')
    if ($workerPairMismatch.ExitCode -eq 0) { throw 'Worker entrypoint unexpectedly passed mismatched paired database identities.' }
    if ($workerPairMismatch.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY PAIRED_DATABASE_IDENTITY_MISMATCH') {
        throw 'Worker paired database mismatch did not expose the sanitized preflight rejection reason.'
    }
    Assert-NoMutation

    $apiPairMismatch = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'canonical-mismatch' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply')
    if ($apiPairMismatch.ExitCode -eq 0) { throw 'API entrypoint unexpectedly passed mismatched paired database identities.' }
    if ($apiPairMismatch.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY PAIRED_DATABASE_IDENTITY_MISMATCH') {
        throw 'API paired database mismatch did not expose the sanitized preflight rejection reason.'
    }
    Assert-NoMutation

    $workerDatasourceOverride = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'datasource-override' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply')
    if ($workerDatasourceOverride.ExitCode -eq 0) { throw 'Worker entrypoint unexpectedly passed an unmodeled datasource override.' }
    if ($workerDatasourceOverride.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY DATASOURCE_OVERRIDE_UNSUPPORTED') {
        $safeReason = [regex]::Match($workerDatasourceOverride.Output, 'STAGING_DB_PREFLIGHT_DENY [A-Z0-9_]+(?: [A-Za-z0-9._:-]+)?').Value
        throw "Worker unmodeled datasource override did not expose the expected sanitized preflight rejection reason. ($safeReason)"
    }
    Assert-NoMutation

    $apiDatasourceOverride = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'datasource-override' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply')
    if ($apiDatasourceOverride.ExitCode -eq 0) { throw 'API entrypoint unexpectedly passed an unmodeled datasource override.' }
    if ($apiDatasourceOverride.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY DATASOURCE_OVERRIDE_UNSUPPORTED') {
        $safeReason = [regex]::Match($apiDatasourceOverride.Output, 'STAGING_DB_PREFLIGHT_DENY [A-Z0-9_]+(?: [A-Za-z0-9._:-]+)?').Value
        throw "API unmodeled datasource override did not expose the expected sanitized preflight rejection reason. ($safeReason)"
    }
    Assert-NoMutation

    $entrypointOverride = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'command-override' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply')
    if ($entrypointOverride.ExitCode -eq 0) { throw 'Worker entrypoint unexpectedly passed a container command override.' }
    if ($entrypointOverride.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY SERVICE_ENTRYPOINT_OVERRIDE_UNSUPPORTED') {
        throw 'Container command override did not expose the sanitized preflight rejection reason.'
    }
    Assert-NoMutation

    $crossProjectMapping = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'cross-project-mapping' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply')
    if ($crossProjectMapping.ExitCode -eq 0) { throw 'API entrypoint unexpectedly passed a cross-project datasource secret mapping.' }
    if ($crossProjectMapping.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY DATASOURCE_SECRET_PROJECT_MISMATCH') {
        throw 'Cross-project secret mapping did not expose the sanitized preflight rejection reason.'
    }
    Assert-NoMutation

    $unverifiedPlan = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'unverified' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project')
    if ($unverifiedPlan.ExitCode -eq 0) { throw 'Plan mode unexpectedly reported an unverified policy as safe.' }
    if ($unverifiedPlan.Output -match 'PREFLIGHT_OK') { throw 'Unverified plan output contained PREFLIGHT_OK.' }
    Assert-NoMutation

    $unverifiedWhatIf = Invoke-EntryPoint `
        -Script 'deploy-issue248-api.ps1' `
        -PolicyMode 'unverified' `
        -Scenario 'normal' `
        -Arguments @('-ProjectId', 'synthetic-project', '-ImageDigest', ('sha256:' + ('a' * 64)), '-Apply', '-WhatIf')
    if ($unverifiedWhatIf.ExitCode -eq 0) { throw 'WhatIf unexpectedly reported an unverified policy as safe.' }
    if ($unverifiedWhatIf.Output -match 'PREFLIGHT_OK') { throw 'Unverified WhatIf output contained PREFLIGHT_OK.' }
    Assert-NoMutation

    $sentinel = Invoke-EntryPoint `
        -Script 'deploy-issue247-worker.ps1' `
        -PolicyMode 'verified-safe' `
        -Scenario 'provider-fail' `
        -Arguments @('-ProjectId', 'synthetic-project', '-Apply')
    if ($sentinel.ExitCode -eq 0) { throw 'Provider failure unexpectedly passed.' }
    if ($sentinel.Output -match 'SENTINEL_PASSWORD|SENTINEL_TOKEN|SENTINEL_SOURCE') {
        throw 'Sensitive sentinel content leaked to entrypoint stdout/stderr.'
    }
    if ($sentinel.Output -notmatch 'STAGING_DB_PREFLIGHT_DENY PROVIDER_READ_FAILED') {
        throw 'Provider failure did not expose the sanitized preflight rejection reason.'
    }
    Assert-NoMutation

    Write-Host 'staging-db-preflight integration: PASS'
} finally {
    $env:PATH = $oldPath
    Remove-Item Env:FAKE_MUTATION_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_COMMAND_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_GCLOUD_SCENARIO -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0
