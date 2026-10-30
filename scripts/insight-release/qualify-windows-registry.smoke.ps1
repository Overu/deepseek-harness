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
$root = "HKCU:\Software\DeepSeekHarnessQualificationSmoke\$name"
$created = $false
try {
    New-Item -Path (Join-Path $root 'legacy') -Force -ErrorAction Stop | Out-Null
    $created = $true
    New-ItemProperty -LiteralPath (Join-Path $root 'legacy') -Name 'PSObject' -Value 'provider-member-collision' -PropertyType String | Out-Null
    New-ItemProperty -LiteralPath (Join-Path $root 'legacy') -Name 'DisplayName' -Value '因赛AI 1.0.9' -PropertyType String | Out-Null

    New-Item -Path (Join-Path $root 'complete') -Force -ErrorAction Stop | Out-Null
    $complete = Join-Path $root 'complete'
    foreach ($field in @{
        InstallLocation = 'C:\fixture root\因赛AI'
        DisplayVersion = '1.0.10-rc.1'
        DisplayName = '因赛AI'
        DisplayIcon = 'C:\fixture root\因赛AI\uninstallerIcon.ico'
        UninstallString = '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"'
    }.GetEnumerator()) {
        New-ItemProperty -LiteralPath $complete -Name $field.Key -Value $field.Value -PropertyType String | Out-Null
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
        $actual.DisplayName -ne '因赛AI' -or $actual.DisplayIcon -ne 'C:\fixture root\因赛AI\uninstallerIcon.ico' -or
        $actual.UninstallString -ne '"C:\fixture root\因赛AI\Uninstall 因赛AI.exe"') {
        throw 'Registry reader did not preserve the complete record'
    }
    Write-Output 'INSIGHT_WINDOWS_REGISTRY_SMOKE records=2 optional=verified collision=verified'
} finally {
    if ($created -and (Test-Path -LiteralPath $root)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
    }
}
