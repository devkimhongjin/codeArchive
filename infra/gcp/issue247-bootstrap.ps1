[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [ValidatePattern('^[a-z][a-z0-9-]{0,98}[a-z0-9]$')]
    [string]$QueueName = 'codearchive-github-staging',

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredApis = @(
    'cloudtasks.googleapis.com',
    'iamcredentials.googleapis.com',
    'run.googleapis.com',
    'secretmanager.googleapis.com'
)

$serviceAccounts = [ordered]@{
    Api         = 'codearchive-api-stg'
    Worker      = 'codearchive-worker-stg'
    TaskInvoker = 'codearchive-task-invoker'
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

    throw 'Google Cloud CLI was not found. Install it from https://cloud.google.com/sdk/docs/install-sdk.'
}

$gcloud = Resolve-Gcloud

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

function Assert-Prerequisites {
    $account = (Invoke-Gcloud -Arguments @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)') |
        Select-Object -First 1).ToString().Trim()
    if (-not $account) {
        throw 'No active gcloud account. Run: gcloud auth login'
    }

    Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
    $billingEnabled = (Invoke-Gcloud -Arguments @(
        'billing', 'projects', 'describe', $ProjectId,
        '--format=value(billingEnabled)'
    ) | Select-Object -First 1).ToString().Trim()
    if ($billingEnabled -ne 'True') {
        throw "Billing is not enabled for project $ProjectId. No resources were changed."
    }

    return $account
}

function Ensure-ServiceAccount {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AccountId,
        [Parameter(Mandatory = $true)]
        [string]$DisplayName
    )

    $email = "$AccountId@$ProjectId.iam.gserviceaccount.com"
    $exists = Test-Gcloud -Arguments @(
        'iam', 'service-accounts', 'describe', $email,
        "--project=$ProjectId", '--format=value(email)'
    )
    if ($exists) {
        return $email
    }

    Invoke-Gcloud -Arguments @(
        'iam', 'service-accounts', 'create', $AccountId,
        "--project=$ProjectId", "--display-name=$DisplayName", '--quiet'
    ) | Out-Null
    return $email
}

function Add-ServiceAccountBinding {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServiceAccount,
        [Parameter(Mandatory = $true)]
        [string]$Member,
        [Parameter(Mandatory = $true)]
        [string]$Role
    )

    Invoke-Gcloud -Arguments @(
        'iam', 'service-accounts', 'add-iam-policy-binding', $ServiceAccount,
        "--project=$ProjectId", "--member=$Member", "--role=$Role", '--quiet'
    ) | Out-Null
}

function Add-QueueBinding {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Member
    )

    Invoke-Gcloud -Arguments @(
        'tasks', 'queues', 'add-iam-policy-binding', $QueueName,
        "--project=$ProjectId", "--location=$Region", "--member=$Member",
        '--role=roles/cloudtasks.enqueuer', '--quiet'
    ) | Out-Null
}

$activeAccount = Assert-Prerequisites
$plan = [ordered]@{
    Account = $activeAccount
    Project = $ProjectId
    Region = $Region
    Queue = $QueueName
    RequiredApis = $requiredApis
    ServiceAccounts = [ordered]@{
        Api = "$($serviceAccounts.Api)@$ProjectId.iam.gserviceaccount.com"
        Worker = "$($serviceAccounts.Worker)@$ProjectId.iam.gserviceaccount.com"
        TaskInvoker = "$($serviceAccounts.TaskInvoker)@$ProjectId.iam.gserviceaccount.com"
    }
    QueueLimits = [ordered]@{
        MaxDispatchesPerSecond = 1
        MaxConcurrentDispatches = 1
        MaxAttempts = 3
        MinBackoff = '5s'
        MaxBackoff = '60s'
    }
}

if (-not $Apply) {
    Write-Host 'Plan only. Re-run with -Apply to create or update these resources.'
    $plan | ConvertTo-Json -Depth 5
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Google Cloud project $ProjectId", 'Configure Issue #247 staging resources')) {
    exit 0
}

Invoke-Gcloud -Arguments (@('services', 'enable') + $requiredApis + @("--project=$ProjectId", '--quiet')) | Out-Null

$apiEmail = Ensure-ServiceAccount -AccountId $serviceAccounts.Api -DisplayName 'CodeArchive staging API'
$workerEmail = Ensure-ServiceAccount -AccountId $serviceAccounts.Worker -DisplayName 'CodeArchive staging GitHub worker'
$taskInvokerEmail = Ensure-ServiceAccount -AccountId $serviceAccounts.TaskInvoker -DisplayName 'CodeArchive Cloud Tasks invoker'

# Materialize the Google-managed Cloud Tasks service agent before granting its
# token-minting permission on the narrow OIDC identity.
Invoke-Gcloud -Arguments @(
    'beta', 'services', 'identity', 'create',
    '--service=cloudtasks.googleapis.com', "--project=$ProjectId", '--quiet'
) | Out-Null
$projectNumber = (Invoke-Gcloud -Arguments @(
    'projects', 'describe', $ProjectId, '--format=value(projectNumber)'
) | Select-Object -First 1).ToString().Trim()
$tasksServiceAgent = "service-$projectNumber@gcp-sa-cloudtasks.iam.gserviceaccount.com"

$queueExists = Test-Gcloud -Arguments @(
    'tasks', 'queues', 'describe', $QueueName,
    "--project=$ProjectId", "--location=$Region", '--format=value(name)'
)
if ($queueExists) {
    Invoke-Gcloud -Arguments @(
        'tasks', 'queues', 'update', $QueueName,
        "--project=$ProjectId", "--location=$Region",
        '--max-dispatches-per-second=1', '--max-concurrent-dispatches=1',
        '--max-attempts=3', '--min-backoff=5s', '--max-backoff=60s',
        '--max-doublings=3', '--quiet'
    ) | Out-Null
} else {
    Invoke-Gcloud -Arguments @(
        'tasks', 'queues', 'create', $QueueName,
        "--project=$ProjectId", "--location=$Region",
        '--max-dispatches-per-second=1', '--max-concurrent-dispatches=1',
        '--max-attempts=3', '--min-backoff=5s', '--max-backoff=60s',
        '--max-doublings=3', '--quiet'
    ) | Out-Null
}

Add-QueueBinding -Member "serviceAccount:$apiEmail"
Add-QueueBinding -Member "serviceAccount:$workerEmail"
Add-ServiceAccountBinding -ServiceAccount $taskInvokerEmail -Member "serviceAccount:$apiEmail" -Role 'roles/iam.serviceAccountUser'
Add-ServiceAccountBinding -ServiceAccount $taskInvokerEmail -Member "serviceAccount:$workerEmail" -Role 'roles/iam.serviceAccountUser'
Add-ServiceAccountBinding -ServiceAccount $taskInvokerEmail -Member "serviceAccount:$tasksServiceAgent" -Role 'roles/iam.serviceAccountTokenCreator'

$plan.Applied = $true
$plan.TasksServiceAgent = $tasksServiceAgent
$plan | ConvertTo-Json -Depth 5
