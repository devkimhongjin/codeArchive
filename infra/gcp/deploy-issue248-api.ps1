[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^sha256:[a-f0-9]{64}$')]
    [string]$ImageDigest,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [string]$Repository = 'codearchive-staging',

    [string]$Service = 'codearchive-api-stg',

    [string]$WorkerService = 'codearchive-github-worker-stg',

    [string]$QueueName = 'codearchive-github-staging',

    [ValidatePattern('^https://[^/]+$')]
    [string]$DashboardOrigin = 'https://codearchive-dashboard-beta.netlify.app',

    [switch]$Apply,

    [switch]$SkipSmokeTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Gcloud {
    if ($env:OS -eq 'Windows_NT') {
        $command = Get-Command gcloud.ps1 -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
        $localInstallerPath = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'
        if (Test-Path -LiteralPath $localInstallerPath) { return $localInstallerPath }
    } else {
        $command = Get-Command gcloud -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    throw 'Google Cloud CLI was not found.'
}

$gcloud = Resolve-Gcloud

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )
    $output = & $gcloud @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'gcloud command failed.'
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

function Invoke-StagingDbPreflight {
    param(
        [Parameter(Mandatory = $true)] [string]$ApiServiceName,
        [Parameter(Mandatory = $true)] [string]$WorkerServiceName,
        [Parameter(Mandatory = $true)] [string]$TargetServiceName
    )

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'Node.js is required for the staging database preflight.'
    }

    $preflightScript = Join-Path $PSScriptRoot 'staging-db-preflight.mjs'
    $policyPath = Join-Path $PSScriptRoot 'staging-db-policy.json'
    if (-not (Test-Path -LiteralPath $preflightScript) -or -not (Test-Path -LiteralPath $policyPath)) {
        throw 'Staging database preflight files are missing.'
    }

    $planPath = Join-Path ([IO.Path]::GetTempPath()) "codearchive-db-preflight-$([Guid]::NewGuid().ToString('N')).json"
    try {
        $prepareOutput = @(& $node.Source $preflightScript prepare `
            --policy $policyPath `
            --project $ProjectId `
            --region $Region `
            --api-service $ApiServiceName `
            --worker-service $WorkerServiceName `
            --gcloud-bin $gcloud `
            --out $planPath 2>&1)
        if ($LASTEXITCODE -ne 0) {
            $safeDenial = @($prepareOutput | ForEach-Object { $_.ToString() } |
                Where-Object { $_ -match '^STAGING_DB_PREFLIGHT_DENY [A-Z0-9_]+(?: [A-Za-z0-9._:-]+)?$' })
            if ($safeDenial.Count -eq 1) {
                throw $safeDenial[0]
            }
            throw 'Staging database preflight denied deployment.'
        }

        $fingerprintLine = @($prepareOutput | ForEach-Object { $_.ToString() } | Where-Object { $_ -match '^PREFLIGHT_OK [a-f0-9]{64}$' })
        if ($fingerprintLine.Count -ne 1) {
            throw 'Staging database preflight did not return a valid fingerprint.'
        }
        $fingerprint = ($fingerprintLine[0] -split ' ', 2)[1]

        $bindingOutput = @(& $node.Source $preflightScript bindings --plan $planPath --service $TargetServiceName 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw 'Staging database preflight execution bindings are invalid.'
        }
        $bindings = ($bindingOutput | ForEach-Object { $_.ToString() }) -join ''
        if ($bindings -notmatch '^SPRING_DATASOURCE_URL=[A-Za-z0-9._-]+:[1-9][0-9]*,SPRING_DATASOURCE_USERNAME=[A-Za-z0-9._-]+:[1-9][0-9]*,SPRING_DATASOURCE_PASSWORD=[A-Za-z0-9._-]+:[1-9][0-9]*$') {
            throw 'Staging database preflight returned malformed execution bindings.'
        }

        return [pscustomobject]@{
            Fingerprint = $fingerprint
            Bindings = $bindings
        }
    } finally {
        Remove-Item -LiteralPath $planPath -Force -ErrorAction SilentlyContinue
    }
}

$dbPreflight = Invoke-StagingDbPreflight -ApiServiceName $Service -WorkerServiceName $WorkerService -TargetServiceName $Service

Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
$registryHost = "$Region-docker.pkg.dev"
$image = "$registryHost/$ProjectId/$Repository/codearchive-api@$ImageDigest"
$apiIdentity = "codearchive-api-stg@$ProjectId.iam.gserviceaccount.com"
$taskInvokerIdentity = "codearchive-task-invoker@$ProjectId.iam.gserviceaccount.com"
$requiredSecrets = @(
    'codearchive-spring-datasource-url',
    'codearchive-spring-datasource-username',
    'codearchive-spring-datasource-password',
    'codearchive-github-client-id',
    'codearchive-github-client-secret',
    'codearchive-github-app-id',
    'codearchive-github-app-private-key-pkcs8',
    'codearchive-github-app-slug'
)

if (-not (Test-Gcloud -Arguments @(
    'artifacts', 'docker', 'images', 'describe', $image, '--format=value(image_summary.digest)'
))) {
    throw 'Immutable image digest was not found.'
}

$workerUrl = (Invoke-Gcloud -Arguments @(
    'run', 'services', 'describe', $WorkerService,
    "--project=$ProjectId", "--region=$Region", '--format=value(status.url)'
) | Select-Object -First 1).ToString().Trim()
if (-not $workerUrl.StartsWith('https://')) {
    throw "Private worker $WorkerService does not have a ready HTTPS URL."
}

$missingSecrets = @($requiredSecrets | Where-Object {
    -not (Test-Gcloud -Arguments @('secrets', 'describe', $_, "--project=$ProjectId", '--format=value(name)'))
})
if ($missingSecrets.Count -gt 0) {
    throw "Missing Secret Manager entries: $($missingSecrets -join ', ')"
}

$currentRevision = ''
if (Test-Gcloud -Arguments @(
    'run', 'services', 'describe', $Service,
    "--project=$ProjectId", "--region=$Region", '--format=value(metadata.name)'
)) {
    $currentRevision = (Invoke-Gcloud -Arguments @(
        'run', 'services', 'describe', $Service,
        "--project=$ProjectId", "--region=$Region", '--format=value(status.latestReadyRevisionName)'
    ) | Select-Object -First 1).ToString().Trim()
}

$plan = [ordered]@{
    Project = $ProjectId
    Region = $Region
    Service = $Service
    Image = $image
    ApiIdentity = $apiIdentity
    WorkerUrl = $workerUrl
    DashboardOrigin = $DashboardOrigin
    PreviousReadyRevision = $currentRevision
    DatabasePreflightFingerprint = $dbPreflight.Fingerprint
    DatabaseSecretVersions = 'pinned-numeric'
    Scaling = [ordered]@{
        Billing = 'request-based'
        MinInstances = 0
        MaxInstances = 2
        Concurrency = 20
        Cpu = 1
        Memory = '1Gi'
        DatabasePool = 2
    }
}

if (-not $Apply) {
    Write-Host 'Plan only. Re-run with -Apply to deploy the public staging API.'
    $plan | ConvertTo-Json -Depth 4
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Cloud Run service $Service", "Deploy public staging API from $image")) {
    exit 0
}

$dbSecretBindings = @($dbPreflight.Bindings.Split(','))
$secretBindings = @(
    $dbSecretBindings
    'GITHUB_CLIENT_ID=codearchive-github-client-id:latest'
    'GITHUB_CLIENT_SECRET=codearchive-github-client-secret:latest'
    'GITHUB_APP_ID=codearchive-github-app-id:latest'
    'GITHUB_APP_PRIVATE_KEY_PKCS8=codearchive-github-app-private-key-pkcs8:latest'
    'GITHUB_APP_SLUG=codearchive-github-app-slug:latest'
) -join ','

$placeholderRedirect = 'https://codearchive-api-stg.invalid/api/login/oauth2/code/github'
$environment = @(
    'SPRING_PROFILES_ACTIVE=prod',
    'GITHUB_DISPATCH_MODE=cloud-tasks',
    'GITHUB_WORKER_HTTP_ENABLED=false',
    "GCP_PROJECT_ID=$ProjectId",
    "GCP_TASKS_LOCATION=$Region",
    "GCP_TASKS_QUEUE=$QueueName",
    "GCP_TASKS_WORKER_URL=$workerUrl",
    "GCP_TASKS_OIDC_SERVICE_ACCOUNT=$taskInvokerIdentity",
    "GCP_TASKS_OIDC_AUDIENCE=$workerUrl",
    "GITHUB_REDIRECT_URI=$placeholderRedirect",
    "DASHBOARD_ORIGIN=$DashboardOrigin",
    "CORS_ALLOWED_ORIGINS=$DashboardOrigin",
    'DB_POOL_MAX_SIZE=2'
) -join ','

Invoke-Gcloud -Arguments @(
    'run', 'deploy', $Service,
    "--project=$ProjectId", "--region=$Region", "--image=$image",
    "--service-account=$apiIdentity", '--allow-unauthenticated',
    '--execution-environment=gen2', '--port=8080', '--cpu=1', '--memory=1Gi',
    '--min-instances=0', '--max-instances=2', '--concurrency=20', '--timeout=60s',
    '--cpu-throttling', '--cpu-boost',
    '--startup-probe=httpGet.path=/actuator/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=5,periodSeconds=5,failureThreshold=24',
    "--set-env-vars=$environment", "--set-secrets=$secretBindings", '--quiet'
) | Out-Null

$apiUrl = (Invoke-Gcloud -Arguments @(
    'run', 'services', 'describe', $Service,
    "--project=$ProjectId", "--region=$Region", '--format=value(status.url)'
) | Select-Object -First 1).ToString().Trim()
if (-not $apiUrl.StartsWith('https://')) {
    throw 'Cloud Run did not return a valid HTTPS API URL.'
}

$redirectUri = "$apiUrl/api/login/oauth2/code/github"
Invoke-Gcloud -Arguments @(
    'run', 'services', 'update', $Service,
    "--project=$ProjectId", "--region=$Region",
    "--update-env-vars=GITHUB_REDIRECT_URI=$redirectUri", '--quiet'
) | Out-Null

# Rollback drills pin traffic to a concrete revision. Explicitly restore the
# normal latest-revision policy so this deployment cannot leave a fresh image
# or configuration revision idle behind that pin.
Invoke-Gcloud -Arguments @(
    'run', 'services', 'update-traffic', $Service,
    "--project=$ProjectId", "--region=$Region", '--to-latest', '--quiet'
) | Out-Null

$readyRevision = (Invoke-Gcloud -Arguments @(
    'run', 'services', 'describe', $Service,
    "--project=$ProjectId", "--region=$Region", '--format=value(status.latestReadyRevisionName)'
) | Select-Object -First 1).ToString().Trim()

if (-not $SkipSmokeTest) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $health = Invoke-RestMethod -Uri "$apiUrl/actuator/health" -Method Get -TimeoutSec 60
    $stopwatch.Stop()
    if ($health.status -ne 'UP') {
        throw "Public staging health check did not report UP: $($health.status)"
    }
    $plan.HealthLatencyMs = $stopwatch.ElapsedMilliseconds
}

$plan.ApiUrl = $apiUrl
$plan.RedirectUri = $redirectUri
$plan.ReadyRevision = $readyRevision
$plan.Deployed = $true
$plan.SmokeTest = if ($SkipSmokeTest) { 'skipped' } else { 'passed' }
$plan | ConvertTo-Json -Depth 4
