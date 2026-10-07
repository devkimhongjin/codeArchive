[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'configure-issue247-recovery.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "codearchive-recovery-$([Guid]::NewGuid().ToString('N'))"
$bin = Join-Path $tempRoot 'bin'
$mutationLog = Join-Path $tempRoot 'mutations.log'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
New-Item -ItemType File -Path $mutationLog | Out-Null

Set-Content -LiteralPath (Join-Path $bin 'gcloud.cmd') -Encoding ascii -Value @'
@echo off
node "%~dp0fake-gcloud.mjs" %*
'@

Set-Content -LiteralPath (Join-Path $bin 'fake-gcloud.mjs') -Encoding utf8NoBOM -Value @'
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const line = args.join(' ');
const scenario = process.env.FAKE_RECOVERY_SCENARIO;
const mutations = () => readFileSync(process.env.FAKE_RECOVERY_MUTATIONS, 'utf8');
const mutation = /^(?:services enable |iam service-accounts create |run services add-iam-policy-binding |scheduler jobs create |scheduler jobs update |scheduler jobs run )/.test(line);
if (mutation) {
  appendFileSync(process.env.FAKE_RECOVERY_MUTATIONS, `${line}\n`);
  process.exit(scenario === 'allow-success' ? 0 : 88);
}
if (line === 'config get-value project') {
  process.stdout.write('synthetic-project\n');
  process.exit(0);
}
const service = line.match(/^run services describe (codearchive-api-stg|codearchive-github-worker-stg) /);
if (service) {
  const worker = service[1] === 'codearchive-github-worker-stg';
  const ref = (name, key = '7') => ({ name, valueFrom: { secretKeyRef: { name: `synthetic-${name.toLowerCase()}`, key } } });
  const env = [
    { name: 'GITHUB_DISPATCH_MODE', value: 'cloud-tasks' },
    { name: 'GITHUB_WORKER_HTTP_ENABLED', value: worker ? 'true' : 'false' },
    { name: 'GCP_TASKS_LOCATION', value: 'asia-southeast1' },
    { name: 'GCP_TASKS_QUEUE', value: worker && scenario === 'queue-mismatch' ? 'other-queue' : 'codearchive-github-staging' },
    { name: 'GCP_TASKS_WORKER_URL', value: 'https://codearchive-github-worker-stg-synthetic-as.a.run.app' },
    { name: 'GCP_TASKS_OIDC_SERVICE_ACCOUNT', value: 'codearchive-task-invoker@synthetic-project.iam.gserviceaccount.com' },
    { name: 'GCP_TASKS_OIDC_AUDIENCE', value: 'https://codearchive-github-worker-stg-synthetic-as.a.run.app' },
    ref('SPRING_DATASOURCE_URL', worker && scenario === 'db-mismatch' ? '8' : '7'),
    ref('SPRING_DATASOURCE_USERNAME'),
    ref('SPRING_DATASOURCE_PASSWORD'),
  ];
  const image = `asia-southeast1-docker.pkg.dev/synthetic-project/staging/api:${'a'.repeat(worker && scenario === 'image-mismatch' ? 39 : 40)}`;
  const revision = `${service[1]}-00001-abc`;
  process.stdout.write(JSON.stringify({
    metadata: { name: service[1], ...(worker && scenario === 'public-annotation'
      ? { annotations: { 'run.googleapis.com/invoker-iam-disabled': 'true' } } : {}) },
    spec: { template: { spec: {
      serviceAccountName: `${worker ? 'codearchive-worker-stg' : 'codearchive-api-stg'}@synthetic-project.iam.gserviceaccount.com`,
      containers: [{ image, env }, ...(worker && scenario === 'multi-container' ? [{ image: 'unreviewed-image', env: [] }] : [])],
    } } },
    status: {
      latestReadyRevisionName: revision,
      traffic: [{ revisionName: revision, percent: 100 }],
      url: `https://${service[1]}-synthetic-as.a.run.app`,
    },
  }));
  process.exit(0);
}
const revision = line.match(/^run revisions describe (codearchive-api-stg|codearchive-github-worker-stg)-00001-abc /);
if (revision) {
  const digest = scenario === 'digest-mismatch' && revision[1] === 'codearchive-github-worker-stg'
    ? 'b'.repeat(64) : 'a'.repeat(64);
  process.stdout.write(JSON.stringify({ status: { imageDigest: `synthetic-image@sha256:${digest}` } }));
  process.exit(0);
}
if (/^run services get-iam-policy /.test(line)) {
  const members = scenario === 'missing-task-invoker' ? []
    : ['serviceAccount:codearchive-task-invoker@synthetic-project.iam.gserviceaccount.com'];
  if (scenario === 'public-worker') members.push('allUsers');
  if (scenario === 'allow-success' && mutations().includes('run services add-iam-policy-binding')) {
    members.push('serviceAccount:codearchive-recovery-invoker@synthetic-project.iam.gserviceaccount.com');
  }
  const bindings = [{ role: 'roles/run.invoker', members }];
  if (scenario === 'conditional-task') bindings[0].condition = { title: 'limited', expression: 'false' };
  if (scenario === 'conditional-recovery') bindings.push({ role: 'roles/run.invoker',
    members: ['serviceAccount:codearchive-recovery-invoker@synthetic-project.iam.gserviceaccount.com'],
    condition: { title: 'limited', expression: 'false' } });
  process.stdout.write(JSON.stringify({ bindings }));
  process.exit(0);
}
if (/^services list --enabled /.test(line)) {
  if (scenario === 'job-drift' || scenario === 'job-body-drift' ||
      scenario === 'job-header-drift' || scenario === 'allow-success') {
    process.stdout.write('cloudscheduler.googleapis.com\n');
  }
  process.exit(0);
}
if (/^iam service-accounts describe /.test(line)) {
  if (scenario === 'allow-success' && mutations().includes('iam service-accounts create')) {
    process.stdout.write(JSON.stringify({ email: 'codearchive-recovery-invoker@synthetic-project.iam.gserviceaccount.com' }));
    process.exit(0);
  }
  process.stderr.write('NOT_FOUND: synthetic account does not exist\n');
  process.exit(1);
}
if (/^scheduler jobs describe /.test(line) &&
    (scenario === 'job-drift' || scenario === 'job-body-drift' || scenario === 'job-header-drift' ||
     (scenario === 'allow-success' && mutations().includes('scheduler jobs create')))) {
  process.stdout.write(JSON.stringify({
    schedule: '17 * * * *', timeZone: 'Etc/UTC', state: 'ENABLED', attemptDeadline: '300s',
    retryConfig: { retryCount: 1, minBackoffDuration: '60s', maxBackoffDuration: '600s' },
    httpTarget: {
      httpMethod: 'POST', uri: scenario === 'job-drift'
        ? 'https://wrong.example/internal/github/recovery'
        : 'https://codearchive-github-worker-stg-synthetic-as.a.run.app/internal/github/recovery',
      ...(scenario === 'job-body-drift' ? { body: 'dW5yZXZpZXdlZA==' } : {}),
      ...(scenario === 'job-header-drift' ? { headers: { Authorization: 'sensitive-scheduler-header' } }
        : { headers: { 'User-Agent': 'Google-Cloud-Scheduler' } }),
      oidcToken: {
        serviceAccountEmail: 'codearchive-recovery-invoker@synthetic-project.iam.gserviceaccount.com',
        audience: 'https://codearchive-github-worker-stg-synthetic-as.a.run.app',
      },
    },
  }));
  process.exit(0);
}
if (/^scheduler jobs describe /.test(line) && scenario === 'allow-success') {
  process.stderr.write('NOT_FOUND: synthetic recovery job does not exist\n');
  process.exit(1);
}
process.stderr.write(`Unexpected fake gcloud command: ${line}\n`);
process.exit(89);
'@

$oldPath = $env:PATH
$oldScenario = $env:FAKE_RECOVERY_SCENARIO
$oldLog = $env:FAKE_RECOVERY_MUTATIONS
try {
    $env:PATH = "$bin;$oldPath"
    $env:FAKE_RECOVERY_MUTATIONS = $mutationLog
    foreach ($scenario in @('valid', 'db-mismatch', 'image-mismatch', 'digest-mismatch',
        'queue-mismatch', 'public-worker', 'missing-task-invoker', 'job-drift',
        'job-body-drift', 'job-header-drift', 'public-annotation', 'multi-container', 'conditional-task',
        'conditional-recovery')) {
        $env:FAKE_RECOVERY_SCENARIO = $scenario
        $output = & pwsh -NoProfile -File $source -ProjectId synthetic-project 2>&1
        if ($scenario -eq 'valid') {
            if ($LASTEXITCODE -ne 0 -or ($output | Out-String) -notmatch '"Mutation": false') {
                throw 'Verified synthetic paired plan was not accepted.'
            }
        } elseif ($LASTEXITCODE -eq 0) {
            throw "Unsafe synthetic scenario was accepted: $scenario"
        }
        if (($output | Out-String) -match 'sensitive-scheduler-header') {
            throw "Sensitive scheduler header was exposed during $scenario."
        }
        if ((Get-Item -LiteralPath $mutationLog).Length -ne 0) {
            throw "Cloud mutation attempted during $scenario plan."
        }
    }
    $env:FAKE_RECOVERY_SCENARIO = 'valid'
    $whatIf = & pwsh -NoProfile -File $source -ProjectId synthetic-project -Apply -WhatIf 2>&1
    if ($LASTEXITCODE -ne 0 -or ($whatIf | Out-String) -notmatch '"Mutation": false' -or
        (Get-Item -LiteralPath $mutationLog).Length -ne 0) {
        throw 'WhatIf attempted a cloud mutation.'
    }
    $disabledApply = & pwsh -NoProfile -File $source -ProjectId synthetic-project -Apply 2>&1
    if ($LASTEXITCODE -eq 0 -or (Get-Item -LiteralPath $mutationLog).Length -ne 0) {
        throw 'Disabled Scheduler API was activated or accepted without prior job inventory.'
    }
    $env:FAKE_RECOVERY_SCENARIO = 'allow-success'
    $applied = & pwsh -NoProfile -File $source -ProjectId synthetic-project -Apply 2>&1
    $calls = @(Get-Content -LiteralPath $mutationLog)
    if ($LASTEXITCODE -ne 0 -or ($applied | Out-String) -notmatch '"Mutation": true' -or
        $calls.Count -ne 3 -or $calls[0] -notmatch '^iam service-accounts create ' -or
        $calls[1] -notmatch '^run services add-iam-policy-binding ' -or
        $calls[2] -notmatch '^scheduler jobs create http ') {
        throw "Synthetic apply did not perform only the three expected operations: $($applied | Out-String)"
    }
    $repeatPlan = & pwsh -NoProfile -File $source -ProjectId synthetic-project 2>&1
    if ($LASTEXITCODE -ne 0 -or ($repeatPlan | Out-String) -notmatch '"JobExists": true' -or
        (Get-Content -LiteralPath $mutationLog).Count -ne 3) {
        throw 'Synthetic re-entry did not detect the existing configured job without mutation.'
    }
    $repeatApply = & pwsh -NoProfile -File $source -ProjectId synthetic-project -Apply 2>&1
    if ($LASTEXITCODE -ne 0 -or ($repeatApply | Out-String) -notmatch '"Mutation": false' -or
        (Get-Content -LiteralPath $mutationLog).Count -ne 3) {
        throw 'Synthetic re-entry apply reported or performed a mutation.'
    }
    Write-Output 'Recovery scheduler integration PASS: verified pair accepted; unsafe drift and disabled API rejected; WhatIf 0 mutations; synthetic apply 3 expected calls; re-entry 0 mutations.'
} finally {
    $env:PATH = $oldPath
    $env:FAKE_RECOVERY_SCENARIO = $oldScenario
    $env:FAKE_RECOVERY_MUTATIONS = $oldLog
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedTemp) -match '^codearchive-recovery-[0-9a-f]{32}$')) {
        throw 'Refusing to remove an unexpected integration fixture path.'
    }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
