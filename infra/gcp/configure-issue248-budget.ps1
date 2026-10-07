[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$')]
    [string]$BillingAccount,

    [ValidateRange(1, 1000000)]
    [decimal]$MonthlyAmount = 10000,

    [string]$DisplayName = 'CodeArchive staging monthly guardrail',

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

function Get-BudgetsJson {
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $output = & $gcloud @(
            'billing', 'budgets', 'list', "--billing-account=$BillingAccount", '--format=json', '--quiet'
        ) 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $output
        }
        if ($attempt -lt 11) {
            Start-Sleep -Seconds 5
        } else {
            throw "Could not list budgets after waiting for API propagation.`n$($output -join [Environment]::NewLine)"
        }
    }
}

Invoke-Gcloud -Arguments @('projects', 'describe', $ProjectId, '--format=value(projectId)') | Out-Null
$linkedAccount = (Invoke-Gcloud -Arguments @(
    'billing', 'projects', 'describe', $ProjectId, '--format=value(billingAccountName)'
) | Select-Object -First 1).ToString().Trim().Split('/')[-1]
if ($linkedAccount -ne $BillingAccount) {
    throw "Project $ProjectId is not linked to billing account $BillingAccount."
}

$plan = [ordered]@{
    Project = $ProjectId
    BillingAccount = $BillingAccount
    DisplayName = $DisplayName
    MonthlyAmount = $MonthlyAmount
    Thresholds = @(50, 80, 100)
    HardCap = $false
}

if (-not $Apply) {
    Write-Host 'Plan only. Budget alerts notify recipients but do not cap or disable spending.'
    $plan | ConvertTo-Json
    exit 0
}

if (-not $PSCmdlet.ShouldProcess("Billing account $BillingAccount", "Configure monthly project budget alerts")) {
    exit 0
}

Invoke-Gcloud -Arguments @(
    'services', 'enable', 'billingbudgets.googleapis.com', "--project=$ProjectId", '--quiet'
) | Out-Null

$existingBudgetJson = Get-BudgetsJson
$existingBudgets = @($existingBudgetJson | Out-String | ConvertFrom-Json)
$budgetName = $existingBudgets |
    Where-Object { $_.displayName -eq $DisplayName } |
    Select-Object -First 1 -ExpandProperty name

$common = @(
    "--billing-account=$BillingAccount",
    "--budget-amount=$MonthlyAmount",
    '--calendar-period=month',
    "--filter-projects=projects/$ProjectId",
    '--credit-types-treatment=include-all-credits'
)
if ($budgetName) {
    Invoke-Gcloud -Arguments (@(
        'billing', 'budgets', 'update', $budgetName,
        '--clear-threshold-rules',
        '--add-threshold-rule=percent=0.50,basis=current-spend',
        '--add-threshold-rule=percent=0.80,basis=current-spend',
        '--add-threshold-rule=percent=1.00,basis=current-spend'
    ) + $common + @('--quiet')) | Out-Null
} else {
    Invoke-Gcloud -Arguments (@(
        'billing', 'budgets', 'create', "--display-name=$DisplayName",
        '--threshold-rule=percent=0.50,basis=current-spend',
        '--threshold-rule=percent=0.80,basis=current-spend',
        '--threshold-rule=percent=1.00,basis=current-spend'
    ) + $common + @('--quiet')) | Out-Null
}

$budgetJson = Get-BudgetsJson
$budget = $budgetJson | Out-String | ConvertFrom-Json |
    Where-Object { $_.displayName -eq $DisplayName } |
    Select-Object -First 1
if (-not $budget) {
    throw "Budget $DisplayName was not returned after apply."
}
$plan.BudgetName = $budget.name
$plan.CurrencyCode = $budget.amount.specifiedAmount.currencyCode
$plan.Applied = $true
$plan | ConvertTo-Json
