[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [ValidateSet('asia-southeast1')]
    [string]$Region = 'asia-southeast1',

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$apiName = 'codearchive-api-stg'
$workerName = 'codearchive-github-worker-stg'
$accountId = 'codearchive-recovery-invoker'
$accountEmail = "$accountId@$ProjectId.iam.gserviceaccount.com"
$jobName = 'codearchive-github-recovery'
$schedule = '17 * * * *'

function Resolve-Gcloud {
    # The PowerShell shim inherits -WhatIf and emits noisy environment changes.
    $command = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
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

function Get-OptionalGcloudJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & $gcloud @Arguments 2>&1
    if ($LASTEXITCODE -eq 0) {
        return ($output | Out-String | ConvertFrom-Json)
    }
    if (($output -join ' ') -match '(?i)\bNOT_FOUND\b') {
        return $null
    }
    throw "Could not inspect the optional Google Cloud resource: gcloud $($Arguments[0..2] -join ' ')"
}

function Get-Service {
    param([Parameter(Mandatory = $true)][string]$Name)
    $json = Invoke-Gcloud -Arguments @(
        'run', 'services', 'describe', $Name,
        "--project=$ProjectId", "--region=$Region", '--format=json'
    )
    return ($json | Out-String | ConvertFrom-Json)
}

function Get-Setting {
    param($Service, [string]$Name)
    $matching = @($Service.spec.template.spec.containers[0].env | Where-Object { $_.name -eq $Name })
    if ($matching.Count -ne 1 -or [string]::IsNullOrWhiteSpace($matching[0].value)) {
        throw "Service setting $Name is missing or ambiguous."
    }
    return $matching[0].value
}

function Get-DbBinding {
    param($Service, [string]$Name)
    $matching = @($Service.spec.template.spec.containers[0].env | Where-Object { $_.name -eq $Name })
    if ($matching.Count -ne 1 -or -not $matching[0].valueFrom.secretKeyRef) {
        throw "DB binding $Name is missing or ambiguous."
    }
    $ref = $matching[0].valueFrom.secretKeyRef
    if ([string]::IsNullOrWhiteSpace($ref.name) -or $ref.key -notmatch '^[1-9][0-9]*$') {
        throw "DB binding $Name must use a named secret and numeric version."
    }
    return "$($ref.name):$($ref.key)"
}

function Assert-ReadyService {
    param($Service, [string]$Name)
    $traffic = @($Service.status.traffic)
    if ($Service.metadata.name -ne $Name -or
        @($Service.spec.template.spec.containers).Count -ne 1 -or
        [string]::IsNullOrWhiteSpace($Service.status.latestReadyRevisionName) -or
        $traffic.Count -ne 1 -or $traffic[0].percent -ne 100 -or
        $traffic[0].revisionName -ne $Service.status.latestReadyRevisionName) {
        throw "Service $Name is not serving its only latest ready revision at 100%."
    }
}

function Assert-InvokerIamEnabled {
    param($Service)
    $locations = @($Service.metadata)
    $templateMetadata = $Service.spec.template.PSObject.Properties['metadata']
    if ($templateMetadata -and $templateMetadata.Value) { $locations += $templateMetadata.Value }
    foreach ($location in $locations) {
        $annotations = $location.PSObject.Properties['annotations']
        if (-not $annotations -or -not $annotations.Value) { continue }
        $setting = $annotations.Value.PSObject.Properties['run.googleapis.com/invoker-iam-disabled']
        if ($setting -and [string]$setting.Value -ne 'false') {
            throw 'Worker has a disabled or ambiguous Cloud Run Invoker IAM check.'
        }
    }
}

function Assert-UnconditionalInvoker {
    param($Policy, [string]$Member, [string]$Description)
    $matches = @($Policy.bindings | Where-Object {
        $_.role -eq 'roles/run.invoker' -and $_.members -contains $Member
    })
    if ($matches.Count -ne 1 -or $matches[0].PSObject.Properties['condition']) {
        throw "$Description lacks exactly one unconditional Cloud Run invoker binding."
    }
}

function Assert-ExistingJob {
    param($Job, [string]$TargetUrl, [string]$Audience)
    $bodyProperty = $Job.httpTarget.PSObject.Properties['body']
    if ($bodyProperty -and -not [string]::IsNullOrEmpty([string]$bodyProperty.Value)) {
        throw 'Existing recovery job has an unreviewed request body.'
    }
    $headersProperty = $Job.httpTarget.PSObject.Properties['headers']
    if ($headersProperty -and $headersProperty.Value) {
        foreach ($header in $headersProperty.Value.PSObject.Properties) {
            if ($header.Name -ine 'User-Agent' -or [string]$header.Value -ne 'Google-Cloud-Scheduler') {
                throw 'Existing recovery job has an unreviewed HTTP header.'
            }
        }
    }
    if ($Job.schedule -ne $schedule -or $Job.timeZone -ne 'Etc/UTC' -or
        $Job.httpTarget.httpMethod -ne 'POST' -or $Job.httpTarget.uri -ne $TargetUrl -or
        $Job.httpTarget.oidcToken.serviceAccountEmail -ne $accountEmail -or
        $Job.httpTarget.oidcToken.audience -ne $Audience -or
        $Job.state -ne 'ENABLED' -or $Job.retryConfig.retryCount -ne 1 -or
        $Job.retryConfig.minBackoffDuration -ne '60s' -or
        $Job.retryConfig.maxBackoffDuration -ne '600s' -or
        $Job.attemptDeadline -ne '300s') {
        throw 'Existing recovery job differs from the approved target, identity, schedule, or state.'
    }
}

$activeProject = (Invoke-Gcloud -Arguments @('config', 'get-value', 'project') |
    Select-Object -First 1).ToString().Trim()
if ($activeProject -ne $ProjectId) {
    throw "Active gcloud project does not match the explicit project $ProjectId."
}

$api = Get-Service -Name $apiName
$worker = Get-Service -Name $workerName
Assert-ReadyService -Service $api -Name $apiName
Assert-ReadyService -Service $worker -Name $workerName
Assert-InvokerIamEnabled -Service $worker

if ((Get-Setting -Service $api -Name 'GITHUB_DISPATCH_MODE') -ne 'cloud-tasks' -or
    (Get-Setting -Service $api -Name 'GITHUB_WORKER_HTTP_ENABLED') -ne 'false' -or
    (Get-Setting -Service $worker -Name 'GITHUB_DISPATCH_MODE') -ne 'cloud-tasks' -or
    (Get-Setting -Service $worker -Name 'GITHUB_WORKER_HTTP_ENABLED') -ne 'true') {
    throw 'API/worker dispatch or private endpoint roles are not the verified Cloud Tasks pair.'
}
if ($api.spec.template.spec.serviceAccountName -ne "codearchive-api-stg@$ProjectId.iam.gserviceaccount.com" -or
    $worker.spec.template.spec.serviceAccountName -ne "codearchive-worker-stg@$ProjectId.iam.gserviceaccount.com") {
    throw 'API or worker service identity differs from the expected dedicated identity.'
}

$apiImage = $api.spec.template.spec.containers[0].image
$workerImage = $worker.spec.template.spec.containers[0].image
if ($apiImage -ne $workerImage -or $apiImage -notmatch '(:[0-9a-f]{40}|@sha256:[0-9a-f]{64})$') {
    throw 'API/worker images differ or are not pinned to a commit/digest.'
}
$apiRevision = Invoke-Gcloud -Arguments @(
    'run', 'revisions', 'describe', $api.status.latestReadyRevisionName,
    "--project=$ProjectId", "--region=$Region", '--format=json'
) | Out-String | ConvertFrom-Json
$workerRevision = Invoke-Gcloud -Arguments @(
    'run', 'revisions', 'describe', $worker.status.latestReadyRevisionName,
    "--project=$ProjectId", "--region=$Region", '--format=json'
) | Out-String | ConvertFrom-Json
$imageDigest = $apiRevision.status.imageDigest
if ($imageDigest -notmatch '@sha256:[0-9a-f]{64}$' -or
    $imageDigest -ne $workerRevision.status.imageDigest) {
    throw 'Serving API and worker revisions do not resolve to the same image digest.'
}

foreach ($name in @('SPRING_DATASOURCE_URL', 'SPRING_DATASOURCE_USERNAME', 'SPRING_DATASOURCE_PASSWORD')) {
    if ((Get-DbBinding -Service $api -Name $name) -ne (Get-DbBinding -Service $worker -Name $name)) {
        throw "API and worker use different numeric secret bindings for $name."
    }
}

$workerUrl = $worker.status.url
if ($workerUrl -notmatch '^https://[a-z0-9-]+\.a\.run\.app$') {
    throw 'Worker URL is not the expected HTTPS Cloud Run service URL.'
}
foreach ($name in @('GCP_TASKS_LOCATION', 'GCP_TASKS_QUEUE', 'GCP_TASKS_WORKER_URL',
    'GCP_TASKS_OIDC_SERVICE_ACCOUNT', 'GCP_TASKS_OIDC_AUDIENCE')) {
    if ((Get-Setting -Service $api -Name $name) -ne (Get-Setting -Service $worker -Name $name)) {
        throw "API and worker disagree on task delivery setting $name."
    }
}
if ((Get-Setting -Service $worker -Name 'GCP_TASKS_LOCATION') -ne $Region -or
    (Get-Setting -Service $worker -Name 'GCP_TASKS_QUEUE') -ne 'codearchive-github-staging' -or
    (Get-Setting -Service $worker -Name 'GCP_TASKS_WORKER_URL') -ne $workerUrl -or
    (Get-Setting -Service $worker -Name 'GCP_TASKS_OIDC_AUDIENCE') -ne $workerUrl -or
    (Get-Setting -Service $worker -Name 'GCP_TASKS_OIDC_SERVICE_ACCOUNT') -ne
        "codearchive-task-invoker@$ProjectId.iam.gserviceaccount.com") {
    throw 'Task delivery target, queue, or OIDC identity differs from the verified pair.'
}
$targetUrl = "$workerUrl/internal/github/recovery"

$policy = Invoke-Gcloud -Arguments @(
    'run', 'services', 'get-iam-policy', $workerName,
    "--project=$ProjectId", "--region=$Region", '--format=json'
) | Out-String | ConvertFrom-Json
$members = @($policy.bindings | ForEach-Object { $_.members })
if ($members -contains 'allUsers' -or $members -contains 'allAuthenticatedUsers') {
    throw 'Private worker has a public invoker binding.'
}
$taskInvoker = "serviceAccount:codearchive-task-invoker@$ProjectId.iam.gserviceaccount.com"
Assert-UnconditionalInvoker -Policy $policy -Member $taskInvoker -Description 'Cloud Tasks identity'
$member = "serviceAccount:$accountEmail"
$invokerBinding = @($policy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' -and $_.members -contains $member })
if ($invokerBinding.Count -gt 0) {
    Assert-UnconditionalInvoker -Policy $policy -Member $member -Description 'Recovery identity'
}

$enabledApis = Invoke-Gcloud -Arguments @(
    'services', 'list', '--enabled', "--project=$ProjectId",
    '--filter=config.name:cloudscheduler.googleapis.com', '--format=value(config.name)'
)
$schedulerEnabled = @($enabledApis | Where-Object { $_.ToString().Trim() -eq 'cloudscheduler.googleapis.com' }).Count -eq 1
$account = Get-OptionalGcloudJson -Arguments @(
    'iam', 'service-accounts', 'describe', $accountEmail,
    "--project=$ProjectId", '--format=json'
)
$accountExists = [bool]$account
if ($accountExists -and $account.email -ne $accountEmail) {
    throw 'Existing recovery service account identity is inconsistent.'
}
$job = $null
if ($schedulerEnabled) {
    $job = Get-OptionalGcloudJson -Arguments @(
        'scheduler', 'jobs', 'describe', $jobName,
        "--project=$ProjectId", "--location=$Region", '--format=json'
    )
    if ($job) {
        Assert-ExistingJob -Job $job -TargetUrl $targetUrl -Audience $workerUrl
    }
}

$plan = [ordered]@{
    Project = $ProjectId
    Region = $Region
    Worker = $workerName
    WorkerRevision = $worker.status.latestReadyRevisionName
    ImageDigest = $imageDigest
    Job = $jobName
    Schedule = $schedule
    TimeZone = 'Etc/UTC'
    Target = $targetUrl
    OidcAudience = $workerUrl
    ServiceAccount = $accountEmail
    SchedulerApiEnabled = $schedulerEnabled
    ServiceAccountExists = $accountExists
    JobExists = [bool]$job
    Mutation = $false
}

if (-not $Apply) {
    $plan | ConvertTo-Json
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("$ProjectId/$Region/$jobName", 'Configure private recovery invocation')) {
    $plan | ConvertTo-Json
    exit 0
}

if (-not $schedulerEnabled) {
    throw 'Cloud Scheduler API is disabled. Prior Scheduler jobs must be inventoried before enabling it; this helper will not reactivate the API.'
}

if (-not $accountExists) {
    Invoke-Gcloud -Arguments @(
        'iam', 'service-accounts', 'create', $accountId,
        "--project=$ProjectId", '--display-name=CodeArchive recovery invoker', '--quiet'
    ) | Out-Null
    $plan.Mutation = $true
}

if ($invokerBinding.Count -eq 0) {
    Invoke-Gcloud -Arguments @(
        'run', 'services', 'add-iam-policy-binding', $workerName,
        "--project=$ProjectId", "--region=$Region", "--member=$member",
        '--role=roles/run.invoker', '--quiet'
    ) | Out-Null
    $plan.Mutation = $true
}

if (-not $job) {
    Invoke-Gcloud -Arguments @(
        'scheduler', 'jobs', 'create', 'http', $jobName,
        "--project=$ProjectId", "--location=$Region", "--schedule=$schedule",
        '--time-zone=Etc/UTC', '--http-method=POST', "--uri=$targetUrl",
        "--oidc-service-account-email=$accountEmail", "--oidc-token-audience=$workerUrl",
        '--max-retry-attempts=1', '--min-backoff=60s', '--max-backoff=600s',
        '--attempt-deadline=300s', '--quiet'
    ) | Out-Null
    $plan.Mutation = $true
}

$verifiedJob = Invoke-Gcloud -Arguments @(
    'scheduler', 'jobs', 'describe', $jobName,
    "--project=$ProjectId", "--location=$Region", '--format=json'
) | Out-String | ConvertFrom-Json
Assert-ExistingJob -Job $verifiedJob -TargetUrl $targetUrl -Audience $workerUrl
$verifiedPolicy = Invoke-Gcloud -Arguments @(
    'run', 'services', 'get-iam-policy', $workerName,
    "--project=$ProjectId", "--region=$Region", '--format=json'
) | Out-String | ConvertFrom-Json
$verifiedMembers = @($verifiedPolicy.bindings | Where-Object { $_.role -eq 'roles/run.invoker' } |
    ForEach-Object { $_.members })
if ($verifiedMembers -contains 'allUsers' -or
    $verifiedMembers -contains 'allAuthenticatedUsers') {
    throw 'Private worker became public.'
}
Assert-UnconditionalInvoker -Policy $verifiedPolicy -Member $member -Description 'Recovery identity'
Assert-UnconditionalInvoker -Policy $verifiedPolicy -Member $taskInvoker -Description 'Cloud Tasks identity'
$verifiedWorker = Get-Service -Name $workerName
Assert-ReadyService -Service $verifiedWorker -Name $workerName
Assert-InvokerIamEnabled -Service $verifiedWorker
if ($verifiedWorker.status.latestReadyRevisionName -ne $worker.status.latestReadyRevisionName -or
    $verifiedWorker.status.url -ne $workerUrl) {
    throw 'Worker changed during recovery Scheduler configuration.'
}
$plan | ConvertTo-Json
