<# Exercise the qualification registry reader against a private real HKCU key. #>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'qualify-windows-registry.ps1')

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Insight qualification registry smoke requires Windows and PowerShell 7 or newer'
}

$name = [Guid]::NewGuid().ToString('N')
$relativeRoot = "Software\DeepSeekHarnessQualificationSmoke\$name"
$root = "HKCU:\$relativeRoot"
$created = $false
$fixtureKey = $null
try {
    $fixtureKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($relativeRoot)
    if ($null -eq $fixtureKey) { throw 'Could not create the private registry smoke key' }
    $created = $true
    $legacyKey = $fixtureKey.CreateSubKey('legacy')
    try {
        # The registry permits this name; the PowerShell provider reserves it as an object member.
        $legacyKey.SetValue('PSObject', 'provider-member-collision', [Microsoft.Win32.RegistryValueKind]::String)
        $legacyKey.SetValue('DisplayName', '因赛AI 1.0.9', [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $legacyKey.Dispose()
    }

    $completeKey = $fixtureKey.CreateSubKey('complete')
    try {
        foreach ($field in @{
            InstallLocation = 'C:\fixture root\因赛AI'
            DisplayVersion = '1.0.10-rc.1'
            DisplayName = '因赛AI'
            UninstallString = '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"'
        }.GetEnumerator()) {
            $completeKey.SetValue($field.Key, $field.Value, [Microsoft.Win32.RegistryValueKind]::String)
        }
        $completeKey.SetValue('DisplayIcon', '%USERPROFILE%\因赛AI\uninstallerIcon.ico', [Microsoft.Win32.RegistryValueKind]::ExpandString)
    } finally {
        $completeKey.Dispose()
    }

    $records = @(Get-UninstallRecords $root)
    if ($records.Count -ne 2) { throw "Expected two smoke uninstall records, found $($records.Count)" }
    $legacy = $records | Where-Object Key -eq 'legacy'
    if ($legacy.DisplayName -ne '因赛AI 1.0.9' -or $legacy.InstallLocation -ne '' -or $legacy.DisplayVersion -ne '' -or
        $legacy.DisplayIcon -ne '' -or $legacy.UninstallString -ne '') {
        throw 'Registry reader did not preserve the legacy record and its missing optional fields'
    }
    $actual = $records | Where-Object Key -eq 'complete'
    if ($actual.InstallLocation -ne 'C:\fixture root\因赛AI' -or $actual.DisplayVersion -ne '1.0.10-rc.1' -or
        $actual.DisplayName -ne '因赛AI' -or $actual.DisplayIcon -ne '%USERPROFILE%\因赛AI\uninstallerIcon.ico' -or
        $actual.UninstallString -ne '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"') {
        throw 'Registry reader did not preserve the complete record'
    }
    Write-Output 'INSIGHT_WINDOWS_REGISTRY_SMOKE records=2 optional=verified collision=verified'
} finally {
    if ($null -ne $fixtureKey) { $fixtureKey.Dispose() }
    if ($created) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($relativeRoot, $false) }
}
