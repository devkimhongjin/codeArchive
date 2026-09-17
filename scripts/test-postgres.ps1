# Run the migration suite against a disposable PostgreSQL instance.
# Requires Docker and JAVA_HOME (JDK 17+). No existing database or volume is used.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskContainerId = $null
$taskExitCode = 1
$taskEnvironmentNames = @('POSTGRES_PASSWORD', 'PG_TEST_URL', 'PG_TEST_USER', 'PG_TEST_PASSWORD', 'PG_TEST_ALLOW_PUBLIC_SCHEMA_MUTATION')
$taskPreviousEnvironment = @{}
foreach ($taskName in $taskEnvironmentNames) {
    $taskPreviousEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
}

try {
    Get-Command docker -ErrorAction Stop | Out-Null
    docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker engine is unavailable.' }

    $env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
    $taskContainerName = 'codearchive-migration-' + [guid]::NewGuid().ToString('N')
    $taskCreated = docker run --detach --rm --name $taskContainerName `
        --label codearchive.task=migration-test --publish '127.0.0.1::5432' `
        --env POSTGRES_PASSWORD --env POSTGRES_USER=codearchive `
        --env POSTGRES_DB=codearchive_migration_test postgres:17-alpine
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the PostgreSQL test container.' }
    $taskContainerId = ($taskCreated | Select-Object -Last 1).Trim()
    if ($taskContainerId -notmatch '^[a-f0-9]{64}$') { throw 'Unexpected Docker container identifier.' }

    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 45; $taskAttempt++) {
        docker exec $taskContainerId pg_isready -U codearchive -d codearchive_migration_test *> $null
        if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $taskReady) { throw 'PostgreSQL did not become ready within 45 seconds.' }

    $taskBinding = docker port $taskContainerId 5432/tcp
    if ($LASTEXITCODE -ne 0 -or $taskBinding -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Could not determine the loopback PostgreSQL test port.'
    }
    $env:PG_TEST_URL = "jdbc:postgresql://127.0.0.1:$($Matches[1])/codearchive_migration_test"
    $env:PG_TEST_USER = 'codearchive'
    $env:PG_TEST_PASSWORD = $env:POSTGRES_PASSWORD
    # The runner owns this disposable container, so it can explicitly opt in
    # to fixtures that create and drop public source tables.
    $env:PG_TEST_ALLOW_PUBLIC_SCHEMA_MUTATION = 'true'
    Push-Location (Join-Path $taskRepo 'apps/api')
    try {
        & .\mvnw.cmd '-Dtest=PostgreSqlMigrationTest' test
        $taskExitCode = $LASTEXITCODE
    } finally { Pop-Location }
} catch {
    Write-Error -Message $_ -ErrorAction Continue
} finally {
    if ($taskContainerId -match '^[a-f0-9]{64}$') {
        docker stop $taskContainerId | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Could not stop test container $taskContainerId."
            $taskExitCode = 1
        }
    }
    foreach ($taskName in $taskEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnvironment[$taskName], 'Process')
    }
}
exit $taskExitCode
