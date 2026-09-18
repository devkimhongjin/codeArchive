[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^srv-[a-z0-9]+$')]
    [string]$RenderServiceId,

    [string]$RenderCliConfig = (Join-Path $HOME '.render\cli.yaml'),

    [switch]$Apply,

    [switch]$Rotate,

    [switch]$DisablePreviousVersions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$secretMap = [ordered]@{
    SPRING_DATASOURCE_URL         = 'codearchive-spring-datasource-url'
    SPRING_DATASOURCE_USERNAME    = 'codearchive-spring-datasource-username'
    SPRING_DATASOURCE_PASSWORD    = 'codearchive-spring-datasource-password'
    GITHUB_CLIENT_ID              = 'codearchive-github-client-id'
    GITHUB_CLIENT_SECRET          = 'codearchive-github-client-secret'
    GITHUB_APP_ID                 = 'codearchive-github-app-id'
    GITHUB_APP_PRIVATE_KEY_PKCS8  = 'codearchive-github-app-private-key-pkcs8'
    GITHUB_APP_SLUG               = 'codearchive-github-app-slug'
}

function Resolve-Gcloud {
    $command = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $localInstallerPath = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
    if (Test-Path -LiteralPath $localInstallerPath) {
        return $localInstallerPath
    }

    throw 'Google Cloud CLI was not found.'
}

$gcloud = Resolve-Gcloud
$gcloudPs1 = Join-Path (Split-Path -Parent $gcloud) 'gcloud.ps1'
if (-not (Test-Path -LiteralPath $gcloudPs1)) {
    throw "The PowerShell gcloud launcher was not found next to $gcloud."
}

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $output = & $gcloud @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
        throw "gcloud failed: gcloud $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

function Test-Gcloud {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $gcloud @Arguments *> $null
    return $LASTEXITCODE -eq 0
}

function Send-SecretValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SecretId,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:ComSpec
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.Arguments = "/d /s /c `"`"$gcloud`" secrets versions add $SecretId --project=$ProjectId --data-file=- --quiet`""

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Could not start gcloud for secret $SecretId."
    }
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Could not add a version to $SecretId.`n$stdout`n$stderr"
    }
}

function Read-SecretValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SecretId
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Process -Id $PID).Path
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in @(
        '-NoProfile', '-File', $gcloudPs1,
        'secrets', 'versions', 'access', 'latest',
        "--secret=$SecretId", "--project=$ProjectId", '--format=get(payload.data)'
    )) {
        $startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Could not start gcloud to verify secret $SecretId."
    }
    $encodedValue = $process.StandardOutput.ReadToEnd().Trim()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Could not verify $SecretId.`n$stderr"
    }
    $encodedValue = $encodedValue.Replace('_', '/').Replace('-', '+')
    $padding = (4 - ($encodedValue.Length % 4)) % 4
    if ($padding -gt 0) {
        $encodedValue += '=' * $padding
    }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedValue))
}

function Read-RenderToken {
    if (-not (Test-Path -LiteralPath $RenderCliConfig)) {
        throw "Render CLI config not found at $RenderCliConfig. Run: render login"
    }
    $keyLine = Get-Content -LiteralPath $RenderCliConfig |
        Where-Object { $_ -match '^\s+key:' } |
        Select-Object -First 1
    if (-not $keyLine) {
        throw 'The Render CLI config does not contain an API key. Run: render login'
    }
    $token = ($keyLine -replace '^\s+key:\s*', '').Trim().Trim('"').Trim("'")
    if (-not $token) {
        throw 'The Render CLI API key is empty.'
    }
    return $token
}

function Read-RenderEnvironment {
    $token = Read-RenderToken
    $headers = @{ Authorization = "Bearer $token"; Accept = 'application/json' }
    $response = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$RenderServiceId/env-vars?limit=100" -Headers $headers
    $variables = @{}
    foreach ($item in $response) {
        $entry = if ($item.envVar) { $item.envVar } else { $item }
        if ($entry.key -and $null -ne $entry.value) {
            $variables[[string]$entry.key] = [string]$entry.value
        }
    }
    return $variables
}

Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
$renderEnvironment = Read-RenderEnvironment
$missingKeys = @($secretMap.Keys | Where-Object {
    -not $renderEnvironment.ContainsKey($_) -or [string]::IsNullOrEmpty($renderEnvironment[$_])
})
if ($missingKeys.Count -gt 0) {
    throw "Render service $RenderServiceId is missing required values: $($missingKeys -join ', ')"
}

$plan = foreach ($sourceKey in $secretMap.Keys) {
    [pscustomobject]@{
        RenderKey = $sourceKey
        SecretId = $secretMap[$sourceKey]
        Present = $true
    }
}

if (-not $Apply) {
    Write-Host 'Plan only. Secret values were checked but are not displayed.'
    $plan | Format-Table -AutoSize
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Google Cloud project $ProjectId", "Import $($secretMap.Count) Render values into Secret Manager")) {
    exit 0
}

Invoke-Gcloud -Arguments @(
    'services', 'enable', 'secretmanager.googleapis.com', "--project=$ProjectId", '--quiet'
) | Out-Null

$apiIdentity = "serviceAccount:codearchive-api-stg@$ProjectId.iam.gserviceaccount.com"
$workerIdentity = "serviceAccount:codearchive-worker-stg@$ProjectId.iam.gserviceaccount.com"
$workerSecretIds = @(
    'codearchive-spring-datasource-url',
    'codearchive-spring-datasource-username',
    'codearchive-spring-datasource-password',
    'codearchive-github-app-id',
    'codearchive-github-app-private-key-pkcs8'
)
$disabledVersionCount = 0

foreach ($sourceKey in $secretMap.Keys) {
    $secretId = $secretMap[$sourceKey]
    $secretExists = Test-Gcloud -Arguments @(
        'secrets', 'describe', $secretId, "--project=$ProjectId", '--format=value(name)'
    )
    if (-not $secretExists) {
        Invoke-Gcloud -Arguments @(
            'secrets', 'create', $secretId, "--project=$ProjectId",
            '--replication-policy=automatic', '--labels=app=codearchive,environment=staging,issue=247', '--quiet'
        ) | Out-Null
    }

    $enabledVersions = & $gcloud @(
        'secrets', 'versions', 'list', $secretId, "--project=$ProjectId",
        '--filter=state:ENABLED', '--limit=1', '--format=value(name)'
    ) 2>$null
    $versionListSucceeded = $LASTEXITCODE -eq 0
    $hasEnabledVersion = $versionListSucceeded -and -not [string]::IsNullOrWhiteSpace(($enabledVersions -join ''))
    if (-not $hasEnabledVersion -or $Rotate) {
        Send-SecretValue -SecretId $secretId -Value $renderEnvironment[$sourceKey]
    }

    $storedValue = Read-SecretValue -SecretId $secretId
    if (-not [string]::Equals($storedValue, $renderEnvironment[$sourceKey], [StringComparison]::Ordinal)) {
        throw "Secret verification failed for $secretId. Its value differs from Render; no value was displayed."
    }

    if ($DisablePreviousVersions) {
        $latestVersion = (Invoke-Gcloud -Arguments @(
            'secrets', 'versions', 'describe', 'latest', "--secret=$secretId", "--project=$ProjectId",
            '--format=value(name)'
        ) | Select-Object -First 1).ToString().Trim().Split('/')[-1]
        $enabledVersionNames = @(& $gcloud @(
            'secrets', 'versions', 'list', $secretId, "--project=$ProjectId",
            '--filter=state:ENABLED', '--format=value(name)'
        ) 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw "Could not list enabled versions for $secretId."
        }
        foreach ($versionName in $enabledVersionNames) {
            $version = $versionName.ToString().Trim().Split('/')[-1]
            if ($version -and $version -ne $latestVersion) {
                Invoke-Gcloud -Arguments @(
                    'secrets', 'versions', 'disable', $version, "--secret=$secretId",
                    "--project=$ProjectId", '--quiet'
                ) | Out-Null
                $disabledVersionCount++
            }
        }
    }

    foreach ($member in @($apiIdentity)) {
        Invoke-Gcloud -Arguments @(
            'secrets', 'add-iam-policy-binding', $secretId, "--project=$ProjectId",
            "--member=$member", '--role=roles/secretmanager.secretAccessor', '--quiet'
        ) | Out-Null
    }
    if ($workerSecretIds -contains $secretId) {
        Invoke-Gcloud -Arguments @(
            'secrets', 'add-iam-policy-binding', $secretId, "--project=$ProjectId",
            "--member=$workerIdentity", '--role=roles/secretmanager.secretAccessor', '--quiet'
        ) | Out-Null
    } else {
        Invoke-Gcloud -Arguments @(
            'secrets', 'remove-iam-policy-binding', $secretId, "--project=$ProjectId",
            "--member=$workerIdentity", '--role=roles/secretmanager.secretAccessor', '--quiet'
        ) -AllowFailure | Out-Null
    }
}

Write-Host "Imported $($secretMap.Count) secrets without printing their values."
if ($Rotate -and -not $DisablePreviousVersions) {
    Write-Warning 'New versions were added. Disable old versions only after Cloud Run smoke tests pass.'
}
if ($DisablePreviousVersions) {
    Write-Host "Disabled $disabledVersionCount superseded secret versions after exact-value verification."
}
