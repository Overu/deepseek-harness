<# Exercise the qualification resolver against a private real HKCU two-key NSIS layout. #>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qualify-windows-registry.ps1')

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Insight qualification registry smoke requires Windows and PowerShell 7 or newer'
}

function Assert-SmokeFailure([scriptblock]$Action, [string]$ExpectedMessage) {
    try {
        & $Action
    } catch {
        if ($_.Exception.Message -notlike "*$ExpectedMessage*") { throw }
        return
    }
    throw "Registry smoke unexpectedly accepted: $ExpectedMessage"
}

$name = [Guid]::NewGuid().ToString('N')
$productInstallKey = [Guid]::NewGuid().ToString('D')
$productUninstallKey = [Guid]::NewGuid().ToString('D')
$relativeRoot = "Software\DeepSeekHarnessQualificationSmoke\$name"
$uninstallRelative = "$relativeRoot\Uninstall"
$installPointerRelative = "$relativeRoot\Install\$productInstallKey"
$uninstallRoot = "HKCU:\$uninstallRelative"
$installPointerKey = "HKCU:\$installPointerRelative"
$allowedDisplayNames = @('因赛AI', '因赛AI 1.0.9', '因赛AI 1.0.10-rc.1')
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "insight-registry-smoke-$name"
$installRoot = Join-Path $temporaryRoot 'install root'
$outsideRoot = Join-Path $temporaryRoot 'outside root'
$uninstaller = Join-Path $installRoot 'Uninstall 因赛AI.exe'
$outsideUninstaller = Join-Path $outsideRoot 'Uninstall 因赛AI.exe'
$created = $false

try {
    New-Item -ItemType Directory -Path $installRoot, $outsideRoot -ErrorAction Stop | Out-Null
    [IO.File]::WriteAllBytes($uninstaller, [byte[]](0))
    [IO.File]::WriteAllBytes($outsideUninstaller, [byte[]](0))

    $uninstallKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$uninstallRelative\$productUninstallKey")
    if ($null -eq $uninstallKey) { throw 'Could not create the private uninstall smoke key' }
    $created = $true
    try {
        # The registry permits this name; the PowerShell provider reserves it as an object member.
        $uninstallKey.SetValue('PSObject', 'provider-member-collision', [Microsoft.Win32.RegistryValueKind]::String)
        $uninstallKey.SetValue('DisplayName', '因赛AI 1.0.9', [Microsoft.Win32.RegistryValueKind]::String)
        $uninstallKey.SetValue('DisplayVersion', '1.0.9', [Microsoft.Win32.RegistryValueKind]::String)
        $uninstallKey.SetValue('DisplayIcon', '%USERPROFILE%\因赛AI\uninstallerIcon.ico', [Microsoft.Win32.RegistryValueKind]::ExpandString)
        $uninstallKey.SetValue('UninstallString', "`"$uninstaller`" /currentuser", [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $uninstallKey.Dispose()
    }

    $completeKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$uninstallRelative\complete")
    try {
        foreach ($field in @{
            InstallLocation = 'C:\fixture root\因赛AI'
            DisplayVersion = '9.9.9'
            DisplayName = 'unrelated product'
            UninstallString = '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"'
        }.GetEnumerator()) {
            $completeKey.SetValue($field.Key, $field.Value, [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally {
        $completeKey.Dispose()
    }

    $pointerKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($installPointerRelative)
    try {
        $pointerKey.SetValue('InstallLocation', $installRoot, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $pointerKey.Dispose()
    }

    $records = @(Get-UninstallRecords $uninstallRoot)
    if ($records.Count -ne 2) { throw "Expected two smoke uninstall records, found $($records.Count)" }
    $legacy = $records | Where-Object Key -eq $productUninstallKey
    if ($legacy.InstallLocation -ne '' -or $legacy.DisplayName -ne '因赛AI 1.0.9' -or
        $legacy.DisplayIcon -ne '%USERPROFILE%\因赛AI\uninstallerIcon.ico') {
        throw 'Registry reader did not preserve the real NSIS uninstall row or literal expandable value'
    }
    $complete = $records | Where-Object Key -eq 'complete'
    if ($complete.InstallLocation -ne 'C:\fixture root\因赛AI' -or $complete.DisplayVersion -ne '9.9.9' -or
        $complete.DisplayName -ne 'unrelated product' -or
        $complete.UninstallString -ne '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"') {
        throw 'Registry reader did not preserve the complete unrelated record'
    }

    $legacyState = Resolve-QualificationInstallState `
        -UninstallRoot $uninstallRoot `
        -InstallPointerKey $installPointerKey `
        -ProductUninstallKey $productUninstallKey `
        -AllowedDisplayNames $allowedDisplayNames `
        -ExpectedVersions @('1.0.9')
    if ($legacyState.InstallLocation -ne (Get-QualificationCanonicalPath $installRoot) -or
        $legacyState.UninstallInstallLocation -ne '') {
        throw 'Resolver did not combine the raw uninstall row with the independent install pointer'
    }

    $uninstallKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$uninstallRelative\$productUninstallKey", $true)
    try {
        $uninstallKey.SetValue('DisplayName', '因赛AI', [Microsoft.Win32.RegistryValueKind]::String)
        $uninstallKey.SetValue('DisplayVersion', '1.0.10-rc.1', [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $uninstallKey.Dispose()
    }
    $updatedState = Resolve-QualificationInstallState `
        -UninstallRoot $uninstallRoot `
        -InstallPointerKey $installPointerKey `
        -ProductUninstallKey $productUninstallKey `
        -AllowedDisplayNames $allowedDisplayNames `
        -ExpectedVersions @('1.0.10-rc.1') `
        -RequiredUninstallKey $productUninstallKey
    if ($updatedState.InstallLocation -ne $legacyState.InstallLocation -or $updatedState.Key -ne $legacyState.Key) {
        throw 'Resolver did not preserve the original key and independent pointer across the update'
    }

    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($installPointerRelative, $false)
    Assert-SmokeFailure {
        Resolve-QualificationInstallState $uninstallRoot $installPointerKey $productUninstallKey $allowedDisplayNames @('1.0.10-rc.1')
    } 'install pointer key is missing'

    $pointerKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($installPointerRelative)
    try {
        $pointerKey.SetValue('InstallLocation', 'relative\install root', [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $pointerKey.Dispose()
    }
    Assert-SmokeFailure {
        Resolve-QualificationInstallState $uninstallRoot $installPointerKey $productUninstallKey $allowedDisplayNames @('1.0.10-rc.1')
    } 'not fully qualified'

    $pointerKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($installPointerRelative, $true)
    try {
        $pointerKey.SetValue('InstallLocation', $installRoot, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $pointerKey.Dispose()
    }
    $uninstallKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$uninstallRelative\$productUninstallKey", $true)
    try {
        $uninstallKey.SetValue('InstallLocation', $outsideRoot, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $uninstallKey.Dispose()
    }
    Assert-SmokeFailure {
        Resolve-QualificationInstallState $uninstallRoot $installPointerKey $productUninstallKey $allowedDisplayNames @('1.0.10-rc.1')
    } 'conflicts with the independent install pointer'

    $uninstallKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$uninstallRelative\$productUninstallKey", $true)
    try {
        $uninstallKey.DeleteValue('InstallLocation', $false)
        $uninstallKey.SetValue('UninstallString', "`"$outsideUninstaller`" /currentuser", [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $uninstallKey.Dispose()
    }
    Assert-SmokeFailure {
        Resolve-QualificationInstallState $uninstallRoot $installPointerKey $productUninstallKey $allowedDisplayNames @('1.0.10-rc.1')
    } 'UninstallString conflicts'

    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("$uninstallRelative\$productUninstallKey", $false)
    Assert-SmokeFailure {
        Assert-QualificationInstallAbsent $uninstallRoot $installPointerKey $productUninstallKey $allowedDisplayNames
    } 'install pointer remained'

    Write-Output 'INSIGHT_WINDOWS_REGISTRY_SMOKE records=2 optional=verified collision=verified two-key=verified negatives=verified'
} finally {
    if ($created) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($relativeRoot, $false) }
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
