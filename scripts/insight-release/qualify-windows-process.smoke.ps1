<# Exercise creation-time-bound process ownership with real Windows CIM and process handles. #>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qualify-windows-registry.ps1')
. (Join-Path $PSScriptRoot 'qualify-windows-process.ps1')

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Insight qualification process smoke requires Windows and PowerShell 7 or newer'
}

function Assert-SmokeFailure([scriptblock]$Action, [string]$ExpectedMessage) {
    try {
        & $Action
    } catch {
        if ($_.Exception.Message -notlike "*$ExpectedMessage*") { throw }
        return
    }
    throw "Process smoke unexpectedly accepted: $ExpectedMessage"
}

function Get-SmokeCimProcess([int]$ProcessId) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 5) {
        $row = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        if ($null -ne $row) { return $row }
        Start-Sleep -Milliseconds 50
    }
    throw "Process smoke could not observe process $ProcessId through CIM"
}

function Start-SmokeChild([int]$Seconds) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $PSHOME 'pwsh.exe'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($argument in @('-NoProfile', '-NonInteractive', '-Command', "Start-Sleep -Seconds $Seconds")) {
        [void]$info.ArgumentList.Add($argument)
    }
    return [Diagnostics.Process]::Start($info)
}

function Start-SmokeAggregateRoot([string]$Root) {
    $executable = Join-Path $Root 'owned-cmd.exe'
    Copy-Item -LiteralPath $env:ComSpec -Destination $executable -ErrorAction Stop
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $executable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($argument in @('/d', '/c', 'ping.exe 127.0.0.1 -n 30 > NUL')) {
        [void]$info.ArgumentList.Add($argument)
    }
    return [Diagnostics.Process]::Start($info)
}

$child = $null
$goneChild = $null
$aggregateProcess = $null
$aggregateIdentities = @()
$aggregateRoot = Join-Path ([IO.Path]::GetTempPath()) "insight-windows-process-smoke-$([Guid]::NewGuid())"
$aggregateRootOwned = $false
$rootIdentity = $null
try {
    $current = Get-Process -Id $PID -ErrorAction Stop
    try {
        $currentPath = Get-QualificationCanonicalPath $current.Path
    } finally {
        $current.Dispose()
    }
    $ownedRoot = Split-Path -Parent $currentPath
    $rootRow = Get-SmokeCimProcess $PID
    $rootSnapshot = New-QualificationProcessSnapshot $rootRow $ownedRoot $null 0
    $rootIdentity = Open-QualificationTrackedProcess $rootSnapshot
    if ($null -eq $rootIdentity) { throw 'Process smoke root exited unexpectedly' }

    $child = Start-SmokeChild 30
    $childRow = Get-SmokeCimProcess $child.Id
    $childSnapshot = New-QualificationProcessSnapshot $childRow $ownedRoot $rootSnapshot 1
    $knownIdentity = Open-QualificationTrackedProcess $childSnapshot
    if ($null -eq $knownIdentity) { throw 'Process smoke child exited unexpectedly' }
    $knownIdentity.Process.Dispose()

    $wrongCreation = [PSCustomObject]@{
        ProcessId = $childSnapshot.ProcessId
        CreationMicrosecondTicks = $childSnapshot.CreationMicrosecondTicks + 10
        Path = $childSnapshot.Path
        Depth = 1
    }
    Assert-SmokeFailure { Open-QualificationTrackedProcess $wrongCreation } 'creation time does not match'
    if ($child.HasExited) { throw 'Creation mismatch test terminated the child' }

    $wrongPath = [PSCustomObject]@{
        ProcessId = $childSnapshot.ProcessId
        CreationMicrosecondTicks = $childSnapshot.CreationMicrosecondTicks
        Path = Join-Path $ownedRoot 'wrong-pwsh.exe'
        Depth = 1
    }
    Assert-SmokeFailure { Open-QualificationTrackedProcess $wrongPath } 'path does not match'
    if ($child.HasExited) { throw 'Path mismatch test terminated the child' }

    $futureParent = [PSCustomObject]@{
        ProcessId = $rootSnapshot.ProcessId
        CreationMicrosecondTicks = $childSnapshot.CreationMicrosecondTicks + 10
    }
    Assert-SmokeFailure { New-QualificationProcessSnapshot $childRow $ownedRoot $futureParent 1 } 'predates its CIM parent'
    $blankRootRow = [PSCustomObject]@{
        ProcessId = $rootRow.ProcessId
        ParentProcessId = $rootRow.ParentProcessId
        CreationDate = $rootRow.CreationDate
        ExecutablePath = ''
    }
    Assert-SmokeFailure { New-QualificationProcessSnapshot $blankRootRow $ownedRoot $null 0 } 'root does not have an exact executable path'

    $blankChildRow = [PSCustomObject]@{
        ProcessId = $childRow.ProcessId
        ParentProcessId = $childRow.ParentProcessId
        CreationDate = $childRow.CreationDate
        ExecutablePath = ''
    }
    $blankDescendant = New-QualificationProcessSnapshot $blankChildRow $ownedRoot $rootSnapshot 1
    $blankIdentity = Open-QualificationTrackedProcess $blankDescendant
    if ($null -eq $blankIdentity) { throw 'Blank-path descendant exited unexpectedly' }
    try {
        Stop-QualificationTrackedProcess $blankIdentity 5000
    } finally {
        $blankIdentity.Process.Dispose()
    }
    if (-not $child.WaitForExit(5000)) { throw 'Blank-path descendant was not stopped through its bound handle' }

    $goneChild = Start-SmokeChild 5
    $goneRow = Get-SmokeCimProcess $goneChild.Id
    $goneSnapshot = New-QualificationProcessSnapshot $goneRow $ownedRoot $rootSnapshot 1
    if (-not $goneChild.WaitForExit(10000)) { throw 'Natural-exit child did not finish' }
    if ($null -ne (Open-QualificationTrackedProcess $goneSnapshot)) {
        throw 'Natural-exit process was not treated as gone'
    }

    if (Test-Path -LiteralPath $aggregateRoot) { throw 'Private process smoke root already exists' }
    [void][IO.Directory]::CreateDirectory($aggregateRoot)
    $aggregateRootOwned = $true
    $aggregateProcess = Start-SmokeAggregateRoot $aggregateRoot
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 10) {
        $aggregateIdentities = @(Get-QualificationOwnedProcessIdentities $aggregateRoot)
        $hasRoot = @($aggregateIdentities | Where-Object ProcessId -eq $aggregateProcess.Id).Count -eq 1
        $hasDescendant = @($aggregateIdentities | Where-Object Depth -gt 0).Count -gt 0
        if ($hasRoot -and $hasDescendant) { break }
        foreach ($identity in $aggregateIdentities) { $identity.Process.Dispose() }
        $aggregateIdentities = @()
        Start-Sleep -Milliseconds 50
    }
    if (-not $hasRoot -or -not $hasDescendant) {
        throw 'Owned process aggregation did not bind the private root and descendant'
    }
    try {
        foreach ($identity in @($aggregateIdentities | Sort-Object Depth -Descending)) {
            Stop-QualificationTrackedProcess $identity 5000
        }
    } finally {
        foreach ($identity in $aggregateIdentities) { $identity.Process.Dispose() }
        $aggregateIdentities = @()
    }
    if (-not $aggregateProcess.WaitForExit(5000)) { throw 'Aggregated private root was not stopped' }

    Write-Output 'INSIGHT_WINDOWS_PROCESS_SMOKE creation=verified parent-chain=verified handle=verified blank-descendant=verified aggregate=verified negatives=verified'
} finally {
    if ($null -ne $rootIdentity) { $rootIdentity.Process.Dispose() }
    foreach ($identity in $aggregateIdentities) { $identity.Process.Dispose() }
    foreach ($process in @($child, $goneChild, $aggregateProcess)) {
        if ($null -eq $process) { continue }
        try {
            if (-not $process.HasExited) {
                $process.Kill($true)
                [void]$process.WaitForExit(5000)
            }
        } finally {
            $process.Dispose()
        }
    }
    if ($aggregateRootOwned -and (Test-Path -LiteralPath $aggregateRoot)) {
        Remove-Item -LiteralPath $aggregateRoot -Recurse -Force -ErrorAction Stop
    }
}
