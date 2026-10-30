<# Qualify the supported 1.0.9-to-RC current-user Windows upgrade without retaining account data. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LegacyInstaller,
    [Parameter(Mandatory)][string]$LegacyVersion,
    [Parameter(Mandatory)][long]$LegacyInstallerSize,
    [Parameter(Mandatory)][string]$LegacyInstallerSha512,
    [Parameter(Mandatory)][string]$ReleaseInstaller,
    [Parameter(Mandatory)][string]$ReleaseVersion,
    [Parameter(Mandatory)][long]$ReleaseInstallerSize,
    [Parameter(Mandatory)][string]$ReleaseInstallerSha512,
    [Parameter(Mandatory)][string]$TemporaryDirectory,
    [Parameter(Mandatory)][string]$CustomInstallRoot,
    [Parameter(Mandatory)][string]$CustomLegacyArguments,
    [Parameter(Mandatory)][string]$NodeExecutable,
    [Parameter(Mandatory)][string]$PayloadVersionHelper,
    [Parameter(Mandatory)][string]$ProductInstallKey,
    [Parameter(Mandatory)][string]$ProductUninstallKey,
    [Parameter(Mandatory)][string]$ProductExecutableName,
    [Parameter(Mandatory)][string]$UnversionedDisplayName,
    [Parameter(Mandatory)][string]$LegacyDisplayName,
    [Parameter(Mandatory)][string]$ReleaseDisplayName,
    [Parameter(Mandatory)][string]$QualificationDeadlineUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qualify-windows-registry.ps1')
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$installPointerKey = "HKCU:\Software\$ProductInstallKey"
$machineUninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$machineInstallPointerKeys = @(
    "HKLM:\SOFTWARE\$ProductInstallKey",
    "HKLM:\SOFTWARE\WOW6432Node\$ProductInstallKey"
)
$allowedDisplayNames = @($UnversionedDisplayName, $LegacyDisplayName, $ReleaseDisplayName)
$userDataRoot = Join-Path $env:APPDATA 'insight-desktop'
$sentinelRoot = Join-Path $userDataRoot 'insight\accounts\0123456789abcdef0123456789abcdef\harness'
$productCacheRoots = @(
    (Join-Path $env:LOCALAPPDATA 'insight-desktop-updater'),
    (Join-Path $env:LOCALAPPDATA 'com.insight-aigc.desktop-updater')
)
$productInstallRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\因赛AI'),
    (Join-Path $env:LOCALAPPDATA 'Programs\因赛AI Dev'),
    (Join-Path $env:LOCALAPPDATA 'Programs\insight-desktop')
)
$programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
$qualificationDeadline = [DateTimeOffset]::Parse($QualificationDeadlineUtc).ToUniversalTime()
$sentinelHashes = @{}
$records = [Collections.Generic.List[object]]::new()
$caseDataOwned = $false
$primaryError = $null
$cleanupFailures = [Collections.Generic.List[object]]::new()

function Get-RemainingWait([int]$MaximumMilliseconds) {
    $remaining = [int64]($qualificationDeadline - [DateTimeOffset]::UtcNow).TotalMilliseconds
    if ($remaining -le 0) { throw 'Insight Windows upgrade qualification exceeded its overall deadline' }
    return [int][Math]::Min($remaining, $MaximumMilliseconds)
}

function Test-ProductRecord([object]$Record) {
    return Test-QualificationProductRecord $Record $ProductUninstallKey $allowedDisplayNames
}

function Get-ProductRecords([string]$Root) {
    return @(Get-UninstallRecords $Root | Where-Object { Test-ProductRecord $_ })
}

function Assert-RegistryState([string]$ExpectedCurrentUserKey, [string]$ExpectedInstallLocation = '') {
    $currentUser = @(Get-ProductRecords $uninstallRoot)
    if ($ExpectedCurrentUserKey -eq '') {
        Assert-QualificationInstallAbsent $uninstallRoot $installPointerKey $ProductUninstallKey $allowedDisplayNames
    } elseif ($currentUser.Count -ne 1 -or $currentUser[0].Key -ne $ExpectedCurrentUserKey) {
        throw 'Insight current-user uninstall record was not unique at the original key'
    } else {
        $pointer = Get-QualificationInstallPointer $installPointerKey
        if (-not $pointer.Exists -or $pointer.InstallLocation -eq '' -or
            (Get-QualificationCanonicalPath $pointer.InstallLocation) -ne (Get-QualificationCanonicalPath $ExpectedInstallLocation)) {
            throw 'Insight current-user install pointer does not match the qualified installation root'
        }
    }
    foreach ($root in $machineUninstallRoots) {
        $machine = @(Get-ProductRecords $root)
        if ($machine.Count -ne 0) { throw "Unexpected machine-wide Insight uninstall record under $root" }
        if ($ExpectedCurrentUserKey -ne '' -and (Test-Path -LiteralPath (Join-Path $root $ExpectedCurrentUserKey))) {
            throw "Unexpected machine-wide uninstall record at the current-user Insight key under $root"
        }
    }
    foreach ($pointerKey in $machineInstallPointerKeys) {
        if ((Get-QualificationInstallPointer $pointerKey).Exists) {
            throw "Unexpected machine-wide Insight install pointer at $pointerKey"
        }
    }
}

function Get-CanonicalPath([string]$Path) {
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathWithin([string]$Path, [string]$Parent) {
    $canonicalPath = Get-CanonicalPath $Path
    $canonicalParent = Get-CanonicalPath $Parent
    return $canonicalPath.StartsWith($canonicalParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparseChain([string]$Path, [string]$Boundary) {
    $current = Get-CanonicalPath $Path
    $canonicalBoundary = Get-CanonicalPath $Boundary
    if ($current -ne $canonicalBoundary -and -not (Test-PathWithin $current $canonicalBoundary)) {
        throw 'Owned Insight path is outside its qualification boundary'
    }
    while ($true) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Owned Insight path contains a reparse point: $current"
        }
        if ($current -eq $canonicalBoundary) { return }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current -or $parent -eq '') { throw 'Owned Insight path did not reach its qualification boundary' }
        $current = Get-CanonicalPath $parent
    }
}

function Assert-InstallerIdentity([string]$Installer, [long]$ExpectedSize, [string]$ExpectedSha512) {
    $item = Get-Item -LiteralPath $Installer -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Qualification installer is not an owned regular file'
    }
    if ($item.Length -ne $ExpectedSize) { throw 'Qualification installer size changed after verification' }
    $hash = Get-FileHash -LiteralPath $Installer -Algorithm SHA512 -ErrorAction Stop
    $actual = [Convert]::ToBase64String([Convert]::FromHexString($hash.Hash))
    if ($actual -cne $ExpectedSha512) { throw 'Qualification installer SHA-512 changed after verification' }
}

function Stop-VerifiedProcess([Diagnostics.Process]$Process, [string]$ExpectedPath, [long]$ExpectedStartTicks) {
    if ($Process.HasExited) { return }
    try {
        $actualPath = Get-CanonicalPath $Process.Path
        $actualStartTicks = $Process.StartTime.ToUniversalTime().Ticks
    } catch [InvalidOperationException] {
        if ($Process.HasExited) { return }
        throw
    }
    if ($actualPath -ne (Get-CanonicalPath $ExpectedPath) -or $actualStartTicks -ne $ExpectedStartTicks) {
        throw 'Refused to stop a process whose identity or creation time changed'
    }
    $Process.Kill($true)
    if (-not $Process.WaitForExit((Get-RemainingWait 10000))) {
        throw 'Owned process tree did not exit after termination'
    }
}

function Invoke-Installer(
    [string]$Installer,
    [string[]]$Arguments,
    [long]$ExpectedSize,
    [string]$ExpectedSha512,
    [string]$RawArguments = ''
) {
    Assert-InstallerIdentity $Installer $ExpectedSize $ExpectedSha512
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Installer
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    if ($RawArguments -ne '') {
        if ($Arguments.Count -ne 0) { throw 'Raw NSIS arguments cannot be combined with ordinary installer arguments' }
        # NSIS treats the unquoted remainder after /D= as the path, so ordinary argv quoting would change the protocol.
        $info.Arguments = $RawArguments
    } else {
        foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    }
    $process = [Diagnostics.Process]::Start($info)
    $expectedPath = Get-CanonicalPath $process.Path
    $expectedStartTicks = $process.StartTime.ToUniversalTime().Ticks
    try {
        if (-not $process.WaitForExit((Get-RemainingWait 300000))) {
            Stop-VerifiedProcess $process $expectedPath $expectedStartTicks
            throw 'Installer timed out'
        }
        if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)" }
    } finally {
        $process.Dispose()
    }
}

function Invoke-OwnedExecutable([string]$Executable, [string[]]$Arguments, [string]$InstallRoot) {
    $canonicalExecutable = Get-CanonicalPath $Executable
    if (-not (Test-PathWithin $canonicalExecutable $InstallRoot)) {
        throw 'Owned executable is outside the exact Insight installation root'
    }
    $item = Get-Item -LiteralPath $canonicalExecutable -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Owned executable is not a regular file'
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $canonicalExecutable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($info)
    $expectedPath = Get-CanonicalPath $process.Path
    $expectedStartTicks = $process.StartTime.ToUniversalTime().Ticks
    try {
        if (-not $process.WaitForExit((Get-RemainingWait 300000))) {
            Stop-VerifiedProcess $process $expectedPath $expectedStartTicks
            throw 'Owned Insight executable timed out'
        }
        if ($process.ExitCode -ne 0) { throw "Owned Insight executable failed with exit code $($process.ExitCode)" }
    } finally {
        $process.Dispose()
    }
}

function Resolve-InstallState([string[]]$ExpectedVersions, [string]$RequiredKey = '', [string[]]$ExcludedKeys = @()) {
    return Resolve-QualificationInstallState `
        -UninstallRoot $uninstallRoot `
        -InstallPointerKey $installPointerKey `
        -ProductUninstallKey $ProductUninstallKey `
        -AllowedDisplayNames $allowedDisplayNames `
        -ExpectedVersions $ExpectedVersions `
        -RequiredUninstallKey $RequiredKey `
        -ExcludedUninstallKeys $ExcludedKeys
}

function Assert-InstallRoot([string]$InstallLocation, [string]$CustomRoot) {
    $canonical = Get-CanonicalPath $InstallLocation
    if ($CustomRoot -ne '') {
        if ($canonical -ne (Get-CanonicalPath $CustomRoot)) {
            throw 'Legacy custom installation directory differs from the requested directory'
        }
        Assert-NoReparseChain $canonical (Split-Path -Parent $TemporaryDirectory)
        return
    }
    $canonicalPrograms = Get-CanonicalPath $programsRoot
    $allowedRoots = @($productInstallRoots | ForEach-Object { Get-CanonicalPath $_ })
    if ($canonical -notin $allowedRoots) {
        throw 'Legacy default installation does not match a preflight-verified product root'
    }
    Assert-NoReparseChain $canonical $canonicalPrograms
}

function New-Sentinels {
    if (-not $caseDataOwned) { throw 'Synthetic account data root was not reserved by this case' }
    if (Test-Path -LiteralPath $sentinelRoot) { throw 'Synthetic Insight account root already exists' }
    foreach ($relative in @('sessions\history.jsonl', 'workspace\workspace.json', 'plugins\plugin.json', 'config\settings.json')) {
        $path = Join-Path $sentinelRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        [IO.File]::WriteAllText($path, "insight-upgrade-sentinel:$relative")
        $sentinelHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    }
}

function Assert-Sentinels {
    foreach ($path in $sentinelHashes.Keys) {
        if (-not (Test-Path -LiteralPath $path)) { throw 'Insight account sentinel was removed' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $sentinelHashes[$path]) {
            throw 'Insight account sentinel changed'
        }
    }
}

function Resolve-ProductExecutable([object]$Record) {
    $candidate = Join-Path $Record.InstallLocation $ProductExecutableName
    if (-not (Test-PathWithin $candidate $Record.InstallLocation)) {
        throw 'Installed Insight executable name escapes InstallLocation'
    }
    $item = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Installed Insight product executable is not a regular file'
    }
    Assert-NoReparseChain $candidate $Record.InstallLocation
    return Get-CanonicalPath $candidate
}

function Assert-InstalledAppVersion([object]$Record, [string]$ExpectedVersion, [ValidateSet('raw', 'asar')][string]$PayloadKind) {
    $executable = Resolve-ProductExecutable $Record
    $productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable).ProductVersion
    $coreVersion = $ExpectedVersion.Split('-')[0]
    if ($productVersion -ne $ExpectedVersion -and $productVersion -ne $coreVersion -and -not $productVersion.StartsWith($coreVersion + '.')) {
        throw 'Installed Insight PE product version does not match the expected release'
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $NodeExecutable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in @('--import', 'tsx', $PayloadVersionHelper, $Record.InstallLocation, $PayloadKind, $ExpectedVersion)) {
        [void]$info.ArgumentList.Add($argument)
    }
    $process = [Diagnostics.Process]::Start($info)
    $expectedPath = Get-CanonicalPath $process.Path
    $expectedStartTicks = $process.StartTime.ToUniversalTime().Ticks
    try {
        if (-not $process.WaitForExit((Get-RemainingWait 60000))) {
            Stop-VerifiedProcess $process $expectedPath $expectedStartTicks
            throw 'Installed Insight payload version inspection timed out'
        }
        $stderr = $process.StandardError.ReadToEnd()
        if ($process.ExitCode -ne 0) { throw "Installed Insight payload version inspection failed: $stderr" }
    } finally {
        $process.Dispose()
    }
}

function Get-OwnedProcessIdentities([string]$InstallRoot) {
    $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $roots = [Collections.Generic.List[object]]::new()
    $children = @{}
    foreach ($row in $rows) {
        $parentKey = [string]$row.ParentProcessId
        if (-not $children.ContainsKey($parentKey)) { $children[$parentKey] = [Collections.Generic.List[object]]::new() }
        $children[$parentKey].Add($row)
        if ($row.ExecutablePath -is [string] -and $row.ExecutablePath -ne '' -and (Test-PathWithin $row.ExecutablePath $InstallRoot)) {
            $roots.Add($row)
        }
    }
    $queue = [Collections.Generic.List[object]]::new()
    foreach ($root in $roots) { $queue.Add([PSCustomObject]@{ Row = $root; Depth = 0 }) }
    $seen = [Collections.Generic.HashSet[int]]::new()
    $identities = [Collections.Generic.List[object]]::new()
    for ($index = 0; $index -lt $queue.Count; $index++) {
        $entry = $queue[$index]
        $pidValue = [int]$entry.Row.ProcessId
        if (-not $seen.Add($pidValue)) { continue }
        $live = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($null -ne $live) {
            try {
                if ($live.HasExited) { continue }
                $path = Get-CanonicalPath $live.Path
                $identities.Add([PSCustomObject]@{
                    ProcessId = $pidValue
                    StartTicks = $live.StartTime.ToUniversalTime().Ticks
                    Path = $path
                    Depth = [int]$entry.Depth
                })
            } catch [InvalidOperationException] {
                if (-not $live.HasExited) { throw }
            } finally {
                $live.Dispose()
            }
        }
        $childRows = $children[[string]$pidValue]
        if ($null -ne $childRows) {
            foreach ($child in $childRows) { $queue.Add([PSCustomObject]@{ Row = $child; Depth = [int]$entry.Depth + 1 }) }
        }
    }
    return @($identities)
}

function Stop-OwnedProcesses([string]$InstallRoot) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $emptyObservations = 0
    while ($emptyObservations -lt 2) {
        [void](Get-RemainingWait 20000)
        if ($timer.Elapsed.TotalSeconds -gt 20) { throw 'Owned Insight processes did not reach quiescence' }
        $owned = @(Get-OwnedProcessIdentities $InstallRoot)
        if ($owned.Count -eq 0) {
            $emptyObservations++
            if ($emptyObservations -lt 2) { Start-Sleep -Milliseconds 100 }
            continue
        }
        $emptyObservations = 0
        foreach ($identity in @($owned | Sort-Object Depth -Descending)) {
            $process = Get-Process -Id $identity.ProcessId -ErrorAction SilentlyContinue
            if ($null -eq $process) { continue }
            try {
                if ($process.HasExited) { continue }
                $actualPath = Get-CanonicalPath $process.Path
                $actualStartTicks = $process.StartTime.ToUniversalTime().Ticks
                if ($actualPath -ne $identity.Path -or $actualStartTicks -ne $identity.StartTicks) {
                    throw 'Refused to stop a reused process id during Insight cleanup'
                }
                $process.Kill()
                if (-not $process.WaitForExit((Get-RemainingWait 5000))) {
                    throw 'Owned Insight process did not exit during cleanup'
                }
            } catch [InvalidOperationException] {
                if (-not $process.HasExited) { throw }
            } finally {
                $process.Dispose()
            }
        }
    }
}

function Remove-Case([object]$Record) {
    if (-not $Record.Active) { return }
    Stop-OwnedProcesses $Record.InstallLocation
    $current = Resolve-InstallState @($LegacyVersion, $ReleaseVersion) $Record.Key
    if ((Get-CanonicalPath $current.InstallLocation) -ne (Get-CanonicalPath $Record.InstallLocation)) {
        throw 'Insight uninstall record changed InstallLocation before cleanup'
    }
    Invoke-OwnedExecutable $current.Uninstaller @('/S') $Record.InstallLocation
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (Test-Path -LiteralPath $Record.InstallLocation) {
        [void](Get-RemainingWait 30000)
        if ($timer.Elapsed.TotalSeconds -gt 30) { throw 'Insight installation remained after uninstallation' }
        Start-Sleep -Milliseconds 100
    }
    if (Test-Path -LiteralPath (Join-Path $uninstallRoot $Record.Key)) {
        throw 'Original Insight current-user uninstall key remained after uninstallation'
    }
    foreach ($root in $machineUninstallRoots) {
        if (Test-Path -LiteralPath (Join-Path $root $Record.Key)) {
            throw 'Original Insight uninstall key appeared under a machine-wide registry root'
        }
    }
    Assert-RegistryState ''
    $Record.Active = $false
}

function Remove-OwnedTree([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $item.PSIsContainer) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        return
    }
    foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)) {
        Remove-OwnedTree $child.FullName
    }
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
}

function Reserve-CaseData {
    if ($caseDataOwned) { throw 'Prior Insight case data ownership was not released' }
    foreach ($path in @($userDataRoot) + $productCacheRoots) {
        if (Test-Path -LiteralPath $path) { throw 'Prior Insight case data or cache remained before independent seeding' }
    }
    New-Item -ItemType Directory -Path $userDataRoot -ErrorAction Stop | Out-Null
    $script:caseDataOwned = $true
}

function Remove-CaseData {
    if (-not $caseDataOwned) { return }
    foreach ($path in @($userDataRoot) + $productCacheRoots) { Remove-OwnedTree $path }
    foreach ($path in @($userDataRoot) + $productCacheRoots) {
        if (Test-Path -LiteralPath $path) { throw 'Owned Insight case data or cache remained after cleanup' }
    }
    $sentinelHashes.Clear()
    $script:caseDataOwned = $false
}

function Assert-FreshQualificationRunner {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:OS -ne 'Windows_NT') {
        throw 'Insight upgrade qualification requires Windows'
    }
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Insight upgrade qualification requires PowerShell 7 or newer' }
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
        throw 'Insight upgrade qualification requires a GitHub-hosted Windows runner'
    }
    $temporaryParent = Split-Path -Parent $TemporaryDirectory
    if (-not [IO.Path]::IsPathFullyQualified($CustomInstallRoot) -or $CustomInstallRoot.Contains('"') -or
        $CustomInstallRoot.Contains("`r") -or $CustomInstallRoot.Contains("`n") -or $CustomInstallRoot.Contains([char]0) -or
        -not (Test-PathWithin $CustomInstallRoot $temporaryParent) -or (Test-PathWithin $CustomInstallRoot $TemporaryDirectory) -or
        -not $CustomInstallRoot.Contains(' ')) {
        throw 'Custom Insight installation root is not the expected independent path with spaces'
    }
    if ($CustomLegacyArguments -cne "/S /currentuser /D=$CustomInstallRoot") {
        throw 'Custom Insight NSIS arguments do not preserve the exact unquoted final /D path'
    }
    foreach ($path in @($userDataRoot) + $productCacheRoots + $productInstallRoots + @($CustomInstallRoot)) {
        if (Test-Path -LiteralPath $path) { throw 'Existing Insight data, cache, or installation root prevents qualification' }
    }
    Assert-RegistryState ''
}

function Invoke-Case([string]$Case, [string]$CustomRoot) {
    Reserve-CaseData
    $before = @(Get-UninstallRecords $uninstallRoot | ForEach-Object { $_.Key })
    if ($CustomRoot -eq '') {
        Invoke-Installer $LegacyInstaller @('/S', '/currentuser') $LegacyInstallerSize $LegacyInstallerSha512
    } else {
        Invoke-Installer $LegacyInstaller @() $LegacyInstallerSize $LegacyInstallerSha512 $CustomLegacyArguments
    }
    $legacyRecord = Resolve-InstallState @($LegacyVersion) '' $before
    Assert-InstallRoot $legacyRecord.InstallLocation $CustomRoot
    $record = [PSCustomObject]@{
        Key = $legacyRecord.Key
        InstallLocation = Get-CanonicalPath $legacyRecord.InstallLocation
        Active = $true
    }
    $records.Add($record)
    Assert-RegistryState $legacyRecord.Key $record.InstallLocation
    Assert-InstalledAppVersion $legacyRecord $LegacyVersion 'raw'
    New-Sentinels
    Invoke-Installer $ReleaseInstaller @('--updated', '/S', '--force-run') $ReleaseInstallerSize $ReleaseInstallerSha512
    $updated = Resolve-InstallState @($ReleaseVersion) $record.Key
    if ((Get-CanonicalPath $updated.InstallLocation) -ne $record.InstallLocation) { throw 'Update changed InstallLocation' }
    Assert-RegistryState $record.Key $record.InstallLocation
    Assert-InstalledAppVersion $updated $ReleaseVersion 'asar'
    Assert-Sentinels
    Stop-OwnedProcesses $record.InstallLocation
    Write-Output "INSIGHT_WINDOWS_UPGRADE case=$Case version=$ReleaseVersion scope=current-user evidence=installer hashes=verified restart=not-qualified"
    Remove-Case $record
    Remove-CaseData
}

try {
    if ($LegacyVersion -ne '1.0.9') { throw 'Qualification must start from Insight 1.0.9' }
    if ($LegacyInstallerSize -le 0 -or $ReleaseInstallerSize -le 0) { throw 'Qualification installer size is invalid' }
    foreach ($hash in @($LegacyInstallerSha512, $ReleaseInstallerSha512)) {
        try { $bytes = [Convert]::FromBase64String($hash) } catch { throw 'Qualification installer SHA-512 is invalid' }
        if ($bytes.Length -ne 64) { throw 'Qualification installer SHA-512 is invalid' }
    }
    foreach ($path in @($LegacyInstaller, $ReleaseInstaller, $NodeExecutable, $PayloadVersionHelper, $TemporaryDirectory)) {
        if (-not (Test-Path -LiteralPath $path)) { throw 'Qualification input path is missing' }
    }
    Assert-FreshQualificationRunner
    Invoke-Case 'default' ''
    Invoke-Case 'custom' $CustomInstallRoot
} catch {
    $primaryError = $_
}

foreach ($record in $records) {
    if (-not $record.Active) { continue }
    try {
        Remove-Case $record
    } catch {
        $cleanupFailures.Add([PSCustomObject]@{ Stage = "installation $($record.Key)"; Error = $_ })
    }
}
try {
    Remove-CaseData
} catch {
    $cleanupFailures.Add([PSCustomObject]@{ Stage = 'owned account and cache data'; Error = $_ })
}

if ($null -ne $primaryError -and $cleanupFailures.Count -eq 0) { throw $primaryError }
if ($null -ne $primaryError -or $cleanupFailures.Count -ne 0) {
    $facts = [Collections.Generic.List[string]]::new()
    if ($null -ne $primaryError) { $facts.Add("qualification failed: $($primaryError.Exception.Message)") }
    foreach ($failure in $cleanupFailures) {
        $facts.Add("cleanup failed for $($failure.Stage): $($failure.Error.Exception.Message)")
    }
    $message = $facts -join '; '
    if ($null -ne $primaryError) { throw [Exception]::new($message, $primaryError.Exception) }
    throw $message
}
