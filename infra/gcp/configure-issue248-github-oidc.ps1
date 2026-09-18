[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$GithubRepository = 'devkimhongjin/codeArchive',

    [string]$ArtifactRepository = 'codearchive-staging',

    [string]$ApiService = 'codearchive-api-stg',

    [string]$WorkerService = 'codearchive-github-worker-stg',

    [string]$QueueName = 'codearchive-github-staging',

    [string]$Pool = 'codearchive-github',

    [string]$Provider = 'codearchive-repo',

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
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $output = & $gcloud @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
        throw "gcloud failed: gcloud $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return $output
}
function Test-Gcloud {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & $gcloud @Arguments *> $null
    return $LASTEXITCODE -eq 0
}

Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
$projectNumber = (Invoke-Gcloud -Arguments @(
    'projects', 'describe', $ProjectId, '--format=value(projectNumber)'
) | Select-Object -First 1).ToString().Trim()
$deployerAccountId = 'codearchive-gha-stg'
$deployerEmail = "$deployerAccountId@$ProjectId.iam.gserviceaccount.com"
$poolName = "projects/$projectNumber/locations/global/workloadIdentityPools/$Pool"
$providerName = "$poolName/providers/$Provider"
$principal = "principalSet://iam.googleapis.com/$poolName/attribute.repository/$GithubRepository"
$condition = "assertion.repository=='$GithubRepository' && assertion.ref=='refs/heads/develop'"
$logReaderRoleId = 'codearchiveStagingLogReader'
$logReaderRole = "projects/$ProjectId/roles/$logReaderRoleId"

$plan = [ordered]@{
    Project = $ProjectId
    GithubRepository = $GithubRepository
    TrustedRef = 'refs/heads/develop'
    DeployerServiceAccount = $deployerEmail
    WorkloadIdentityProvider = $providerName
    Services = @($ApiService, $WorkerService)
    ArtifactRepository = $ArtifactRepository
    Queue = $QueueName
    CustomLogReaderRole = $logReaderRole
    LongLivedServiceAccountKey = $false
}

if (-not $Apply) {
    Write-Host 'Plan only. Re-run with -Apply to configure keyless GitHub Actions deployment.'
    $plan | ConvertTo-Json -Depth 4
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Google Cloud project $ProjectId", "Trust $GithubRepository develop GitHub Actions")) {
    exit 0
}

Invoke-Gcloud -Arguments @(
    'services', 'enable', 'iamcredentials.googleapis.com', 'sts.googleapis.com',
    "--project=$ProjectId", '--quiet'
) | Out-Null

if (-not (Test-Gcloud -Arguments @(
    'iam', 'service-accounts', 'describe', $deployerEmail,
    "--project=$ProjectId", '--format=value(email)'
))) {
    Invoke-Gcloud -Arguments @(
        'iam', 'service-accounts', 'create', $deployerAccountId,
        "--project=$ProjectId", '--display-name=CodeArchive staging GitHub deployer', '--quiet'
    ) | Out-Null
}

if (-not (Test-Gcloud -Arguments @(
    'iam', 'workload-identity-pools', 'describe', $Pool,
    "--project=$ProjectId", '--location=global', '--format=value(name)'
))) {
    Invoke-Gcloud -Arguments @(
        'iam', 'workload-identity-pools', 'create', $Pool,
        "--project=$ProjectId", '--location=global', '--display-name=CodeArchive GitHub Actions', '--quiet'
    ) | Out-Null
}

$providerArguments = @(
    "--project=$ProjectId", '--location=global', "--workload-identity-pool=$Pool",
    '--display-name=CodeArchive repository',
    '--issuer-uri=https://token.actions.githubusercontent.com',
    '--attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref',
    "--attribute-condition=$condition", '--quiet'
)
if (Test-Gcloud -Arguments @(
    'iam', 'workload-identity-pools', 'providers', 'describe', $Provider,
    "--project=$ProjectId", '--location=global', "--workload-identity-pool=$Pool", '--format=value(name)'
)) {
    Invoke-Gcloud -Arguments (@(
        'iam', 'workload-identity-pools', 'providers', 'update-oidc', $Provider
    ) + $providerArguments) | Out-Null
} else {
    Invoke-Gcloud -Arguments (@(
        'iam', 'workload-identity-pools', 'providers', 'create-oidc', $Provider
    ) + $providerArguments) | Out-Null
}

Invoke-Gcloud -Arguments @(
    'iam', 'service-accounts', 'add-iam-policy-binding', $deployerEmail,
    "--project=$ProjectId", "--member=$principal", '--role=roles/iam.workloadIdentityUser', '--quiet'
) | Out-Null

Invoke-Gcloud -Arguments @(
    'artifacts', 'repositories', 'add-iam-policy-binding', $ArtifactRepository,
    "--project=$ProjectId", "--location=$Region", "--member=serviceAccount:$deployerEmail",
    '--role=roles/artifactregistry.writer', '--quiet'
) | Out-Null

foreach ($service in @($ApiService, $WorkerService)) {
    Invoke-Gcloud -Arguments @(
        'run', 'services', 'add-iam-policy-binding', $service,
        "--project=$ProjectId", "--region=$Region", "--member=serviceAccount:$deployerEmail",
        '--role=roles/run.developer', '--quiet'
    ) | Out-Null
}

foreach ($serviceAccount in @(
    "codearchive-api-stg@$ProjectId.iam.gserviceaccount.com",
    "codearchive-worker-stg@$ProjectId.iam.gserviceaccount.com",
    "codearchive-task-invoker@$ProjectId.iam.gserviceaccount.com"
)) {
    Invoke-Gcloud -Arguments @(
        'iam', 'service-accounts', 'add-iam-policy-binding', $serviceAccount,
        "--project=$ProjectId", "--member=serviceAccount:$deployerEmail",
        '--role=roles/iam.serviceAccountUser', '--quiet'
    ) | Out-Null
}

Invoke-Gcloud -Arguments @(
    'tasks', 'queues', 'add-iam-policy-binding', $QueueName,
    "--project=$ProjectId", "--location=$Region", "--member=serviceAccount:$deployerEmail",
    '--role=roles/cloudtasks.enqueuer', '--quiet'
) | Out-Null

if (Test-Gcloud -Arguments @(
    'iam', 'roles', 'describe', $logReaderRoleId, "--project=$ProjectId", '--format=value(name)'
)) {
    Invoke-Gcloud -Arguments @(
        'iam', 'roles', 'update', $logReaderRoleId, "--project=$ProjectId",
        '--title=CodeArchive staging smoke log reader',
        '--description=Can list project logs only to verify staging Cloud Tasks delivery',
        '--permissions=logging.logEntries.list', '--stage=GA', '--quiet'
    ) | Out-Null
} else {
    Invoke-Gcloud -Arguments @(
        'iam', 'roles', 'create', $logReaderRoleId, "--project=$ProjectId",
        '--title=CodeArchive staging smoke log reader',
        '--description=Can list project logs only to verify staging Cloud Tasks delivery',
        '--permissions=logging.logEntries.list', '--stage=GA', '--quiet'
    ) | Out-Null
}
Invoke-Gcloud -Arguments @(
    'projects', 'add-iam-policy-binding', $ProjectId,
    "--member=serviceAccount:$deployerEmail", "--role=$logReaderRole", '--quiet'
) | Out-Null

$plan.Applied = $true
$plan | ConvertTo-Json -Depth 4
