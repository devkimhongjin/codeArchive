[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [string]$Service = 'codearchive-api-stg',

    [ValidatePattern('^[a-z][a-z0-9-]+-\d{5}-[a-z0-9]{3}$')]
    [string]$Revision,

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Gcloud {
    $command = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $path = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
    if (Test-Path -LiteralPath $path) { return $path }
    throw 'Google Cloud CLI was not found.'
}

$gcloud = Resolve-Gcloud
function Invoke-Gcloud {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & $gcloud @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud failed: gcloud $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

$serviceJson = (Invoke-Gcloud -Arguments @(
    'run', 'services', 'describe', $Service,
    "--project=$ProjectId", "--region=$Region", '--format=json'
) | Out-String) | ConvertFrom-Json
$currentRevision = $serviceJson.status.traffic |
    Where-Object { $_.percent -eq 100 } |
    Select-Object -First 1 -ExpandProperty revisionName

if (-not $Revision) {
    $readyRevisions = @((Invoke-Gcloud -Arguments @(
        'run', 'revisions', 'list', "--service=$Service",
        "--project=$ProjectId", "--region=$Region",
        '--filter=status.conditions.type:Ready AND status.conditions.status:True',
        '--sort-by=~metadata.creationTimestamp', '--format=value(metadata.name)'
    )) | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -and $_ -ne $currentRevision })
    $Revision = $readyRevisions | Select-Object -First 1
}

if (-not $Revision) {
    throw "No previous ready revision exists for $Service."
}

$plan = [ordered]@{
    Project = $ProjectId
    Region = $Region
    Service = $Service
    CurrentRevision = $currentRevision
    RollbackRevision = $Revision
}

if (-not $Apply) {
    Write-Host 'Plan only. Re-run with -Apply to move 100% of staging traffic.'
    $plan | ConvertTo-Json
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Cloud Run service $Service", "Route 100% traffic to $Revision")) {
    exit 0
}

Invoke-Gcloud -Arguments @(
    'run', 'services', 'update-traffic', $Service,
    "--project=$ProjectId", "--region=$Region", "--to-revisions=$Revision=100", '--quiet'
) | Out-Null

$apiUrl = $serviceJson.status.url
$health = Invoke-RestMethod -Uri "$apiUrl/actuator/health" -Method Get -TimeoutSec 60
if ($health.status -ne 'UP') {
    throw "Rollback health check did not report UP: $($health.status)"
}

$plan.ApiUrl = $apiUrl
$plan.Health = 'UP'
$plan.Applied = $true
$plan | ConvertTo-Json
