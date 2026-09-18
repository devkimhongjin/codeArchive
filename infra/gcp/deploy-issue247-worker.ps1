[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [string]$Repository = 'codearchive-staging',

    [string]$Service = 'codearchive-github-worker-stg',

    [string]$QueueName = 'codearchive-github-staging',

    [switch]$Apply,

    [switch]$SkipBuild,

    [switch]$SkipSmokeTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
$commit = (git rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) {
    throw 'Could not resolve the current Git commit for the immutable image tag.'
}

$registryHost = "$Region-docker.pkg.dev"
$image = "$registryHost/$ProjectId/$Repository/codearchive-api:$commit"
$workerIdentity = "codearchive-worker-stg@$ProjectId.iam.gserviceaccount.com"
$taskInvokerIdentity = "codearchive-task-invoker@$ProjectId.iam.gserviceaccount.com"
$requiredSecrets = @(
    'codearchive-spring-datasource-url',
    'codearchive-spring-datasource-username',
    'codearchive-spring-datasource-password',
    'codearchive-github-app-id',
    'codearchive-github-app-private-key-pkcs8'
)

$missingSecrets = @($requiredSecrets | Where-Object {
    -not (Test-Gcloud -Arguments @('secrets', 'describe', $_, "--project=$ProjectId", '--format=value(name)'))
})
if ($missingSecrets.Count -gt 0) {
    throw "Missing Secret Manager entries: $($missingSecrets -join ', ')"
}

$plan = [ordered]@{
    Project = $ProjectId
    Region = $Region
    Repository = $Repository
    Service = $Service
    Queue = $QueueName
    Image = $image
    WorkerIdentity = $workerIdentity
    TaskInvokerIdentity = $taskInvokerIdentity
    Scaling = [ordered]@{
        MinInstances = 0
        MaxInstances = 1
        Concurrency = 1
        Cpu = 1
        Memory = '1Gi'
        CpuThrottling = $true
    }
}

if (-not $Apply) {
    Write-Host 'Plan only. Re-run with -Apply to build, push, and deploy the private worker.'
    $plan | ConvertTo-Json -Depth 4
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Cloud Run service $Service", "Build and deploy $image")) {
    exit 0
}

Invoke-Gcloud -Arguments @(
    'services', 'enable', 'artifactregistry.googleapis.com', 'run.googleapis.com',
    "--project=$ProjectId", '--quiet'
) | Out-Null

$repositoryExists = Test-Gcloud -Arguments @(
    'artifacts', 'repositories', 'describe', $Repository,
    "--project=$ProjectId", "--location=$Region", '--format=value(name)'
)
if (-not $repositoryExists) {
    Invoke-Gcloud -Arguments @(
        'artifacts', 'repositories', 'create', $Repository,
        "--project=$ProjectId", "--location=$Region", '--repository-format=docker',
        '--description=CodeArchive staging images', '--labels=app=codearchive,environment=staging', '--quiet'
    ) | Out-Null
}

$cleanupPolicy = Join-Path $PSScriptRoot 'artifact-cleanup.json'
Invoke-Gcloud -Arguments @(
    'artifacts', 'repositories', 'set-cleanup-policies', $Repository,
    "--project=$ProjectId", "--location=$Region", "--policy=$cleanupPolicy", '--no-dry-run', '--quiet'
) | Out-Null

if (-not $SkipBuild) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI was not found.'
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is not running.'
    }
    docker build --file apps/api/Dockerfile --tag $image apps/api
    if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
}

# Authenticate this push directly so the script works even when a shell opened
# before Cloud SDK installation cannot resolve docker-credential-gcloud. The
# short-lived token is kept in process memory and streamed to Docker over stdin.
$accessToken = (Invoke-Gcloud -Arguments @('auth', 'print-access-token') | Select-Object -First 1).ToString().Trim()
if (-not $accessToken) {
    throw 'Could not obtain a short-lived Google Cloud access token.'
}
$temporaryDockerConfig = Join-Path ([IO.Path]::GetTempPath()) "codearchive-docker-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryDockerConfig | Out-Null
try {
    $accessToken | docker --config $temporaryDockerConfig login --username oauth2accesstoken --password-stdin "https://$registryHost" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker login to Artifact Registry failed.' }
    $accessToken = $null
    docker --config $temporaryDockerConfig push $image
    if ($LASTEXITCODE -ne 0) { throw 'Docker push failed.' }
}
finally {
    $accessToken = $null
    $resolvedTemporaryDockerConfig = [IO.Path]::GetFullPath($temporaryDockerConfig)
    $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $expectedPrefix = $resolvedTempRoot + [IO.Path]::DirectorySeparatorChar + 'codearchive-docker-'
    if ($resolvedTemporaryDockerConfig.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemporaryDockerConfig -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Warning "Skipped cleanup of unexpected Docker config path: $resolvedTemporaryDockerConfig"
    }
}

$secretBindings = @(
    'SPRING_DATASOURCE_URL=codearchive-spring-datasource-url:latest',
    'SPRING_DATASOURCE_USERNAME=codearchive-spring-datasource-username:latest',
    'SPRING_DATASOURCE_PASSWORD=codearchive-spring-datasource-password:latest',
    'GITHUB_APP_ID=codearchive-github-app-id:latest',
    'GITHUB_APP_PRIVATE_KEY_PKCS8=codearchive-github-app-private-key-pkcs8:latest'
) -join ','

$placeholderUrl = 'https://codearchive-worker.invalid'
$environment = @(
    'SPRING_PROFILES_ACTIVE=prod',
    'GITHUB_DISPATCH_MODE=cloud-tasks',
    'GITHUB_WORKER_HTTP_ENABLED=true',
    "GCP_PROJECT_ID=$ProjectId",
    "GCP_TASKS_LOCATION=$Region",
    "GCP_TASKS_QUEUE=$QueueName",
    "GCP_TASKS_WORKER_URL=$placeholderUrl",
    "GCP_TASKS_OIDC_SERVICE_ACCOUNT=$taskInvokerIdentity",
    "GCP_TASKS_OIDC_AUDIENCE=$placeholderUrl",
    'DB_POOL_MAX_SIZE=2'
) -join ','

Invoke-Gcloud -Arguments @(
    'run', 'deploy', $Service,
    "--project=$ProjectId", "--region=$Region", "--image=$image",
    "--service-account=$workerIdentity", '--no-allow-unauthenticated',
    '--execution-environment=gen2', '--port=8080', '--cpu=1', '--memory=1Gi',
    '--min-instances=0', '--max-instances=1', '--concurrency=1', '--timeout=60s',
    '--cpu-throttling', '--cpu-boost',
    '--startup-probe=httpGet.path=/actuator/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=5,periodSeconds=5,failureThreshold=24',
    "--set-env-vars=$environment", "--set-secrets=$secretBindings", '--quiet'
) | Out-Null

$workerUrl = (Invoke-Gcloud -Arguments @(
    'run', 'services', 'describe', $Service,
    "--project=$ProjectId", "--region=$Region", '--format=value(status.url)'
) | Select-Object -First 1).ToString().Trim()
if (-not $workerUrl.StartsWith('https://')) {
    throw "Cloud Run did not return a valid HTTPS worker URL: $workerUrl"
}

Invoke-Gcloud -Arguments @(
    'run', 'services', 'update', $Service,
    "--project=$ProjectId", "--region=$Region",
    "--update-env-vars=GCP_TASKS_WORKER_URL=$workerUrl,GCP_TASKS_OIDC_AUDIENCE=$workerUrl", '--quiet'
) | Out-Null
Invoke-Gcloud -Arguments @(
    'run', 'services', 'add-iam-policy-binding', $Service,
    "--project=$ProjectId", "--region=$Region",
    "--member=serviceAccount:$taskInvokerIdentity", '--role=roles/run.invoker', '--quiet'
) | Out-Null

if (-not $SkipSmokeTest) {
    $smokePassed = $false
    [long]$missingJobId = 9000000000000000000L + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() % 100000000000000000L)
    for ($round = 0; $round -lt 4 -and -not $smokePassed; $round++) {
        $taskId = "issue247-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())-$round"
        Invoke-Gcloud -Arguments @(
            'tasks', 'create-http-task', $taskId,
            "--project=$ProjectId", "--location=$Region", "--queue=$QueueName",
            "--url=$workerUrl/internal/github/jobs/$missingJobId", '--method=POST',
            '--header=Content-Type: application/json', "--body-content={`"jobId`":$missingJobId}",
            "--oidc-service-account-email=$taskInvokerIdentity", "--oidc-token-audience=$workerUrl", '--quiet'
        ) | Out-Null

        for ($attempt = 0; $attempt -lt 6; $attempt++) {
            Start-Sleep -Seconds 5
            $match = Invoke-Gcloud -Arguments @(
                'logging', 'read',
                "resource.type=cloud_run_revision AND resource.labels.service_name=$Service AND httpRequest.status=204 AND httpRequest.requestUrl:`"/internal/github/jobs/$missingJobId`"",
                "--project=$ProjectId", '--freshness=10m', '--limit=1', '--format=value(httpRequest.status)'
            ) -AllowFailure
            if (($match -join '').Trim() -eq '204') {
                $smokePassed = $true
                break
            }
        }
    }
    if (-not $smokePassed) {
        throw 'The OIDC Cloud Tasks smoke request did not produce a Cloud Run 204 log within the IAM propagation window.'
    }
}

$plan.WorkerUrl = $workerUrl
$plan.Deployed = $true
$plan.SmokeTest = if ($SkipSmokeTest) { 'skipped' } else { 'passed' }
$plan | ConvertTo-Json -Depth 4
