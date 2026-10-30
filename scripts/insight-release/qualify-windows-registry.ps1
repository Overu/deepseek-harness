<# Read Windows uninstall records without relying on registry-provider dynamic properties. #>

function Open-QualificationRegistryKey([string]$Root) {
    $prefixes = @(
        [PSCustomObject]@{ Prefix = 'HKCU:\'; Base = [Microsoft.Win32.Registry]::CurrentUser },
        [PSCustomObject]@{ Prefix = 'HKLM:\'; Base = [Microsoft.Win32.Registry]::LocalMachine }
    )
    foreach ($entry in $prefixes) {
        if ($Root.StartsWith($entry.Prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $subkey = $Root.Substring($entry.Prefix.Length).Replace('/', '\')
            return $entry.Base.OpenSubKey($subkey, $false)
        }
    }
    throw "Unsupported qualification registry root: $Root"
}

function Get-QualificationRegistryText([Microsoft.Win32.RegistryKey]$Entry, [string]$Name) {
    $value = $Entry.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($null -eq $value) { return '' }
    return [string]$value
}

function Get-QualificationInstallPointer([string]$Key) {
    [Microsoft.Win32.RegistryKey]$entry = Open-QualificationRegistryKey $Key
    if ($null -eq $entry) {
        return [PSCustomObject]@{ Exists = $false; InstallLocation = '' }
    }
    try {
        return [PSCustomObject]@{
            Exists = $true
            InstallLocation = Get-QualificationRegistryText $entry 'InstallLocation'
        }
    } finally {
        $entry.Dispose()
    }
}

function Get-UninstallRecords([string]$Root) {
    [Microsoft.Win32.RegistryKey]$rootKey = Open-QualificationRegistryKey $Root
    if ($null -eq $rootKey) { return @() }
    try {
        return @(
            foreach ($name in @($rootKey.GetSubKeyNames() | Sort-Object)) {
                [Microsoft.Win32.RegistryKey]$entry = $rootKey.OpenSubKey($name, $false)
                if ($null -eq $entry) { throw "Uninstall registry entry disappeared during qualification: $name" }
                try {
                    [PSCustomObject]@{
                        Root = $Root
                        Key = $name
                        InstallLocation = Get-QualificationRegistryText $entry 'InstallLocation'
                        DisplayVersion = Get-QualificationRegistryText $entry 'DisplayVersion'
                        DisplayName = Get-QualificationRegistryText $entry 'DisplayName'
                        DisplayIcon = Get-QualificationRegistryText $entry 'DisplayIcon'
                        UninstallString = Get-QualificationRegistryText $entry 'UninstallString'
                    }
                } finally {
                    $entry.Dispose()
                }
            }
        )
    } finally {
        $rootKey.Dispose()
    }
}

function Get-QualificationCanonicalPath([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path)) {
        throw 'Insight installation registry path is not fully qualified'
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-QualificationPathWithin([string]$Path, [string]$Parent) {
    $canonicalPath = Get-QualificationCanonicalPath $Path
    $canonicalParent = Get-QualificationCanonicalPath $Parent
    return $canonicalPath.StartsWith($canonicalParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Test-QualificationProductRecord([object]$Record, [string]$ProductUninstallKey, [string[]]$AllowedDisplayNames) {
    return $Record.Key -eq $ProductUninstallKey -or $Record.DisplayName -in $AllowedDisplayNames
}

function Resolve-QualificationUninstaller([string]$Command, [string]$InstallLocation) {
    $candidate = ''
    $trimmed = $Command.Trim()
    if ($trimmed -match '^"([^"]+\.exe)"(?:\s+.*)?$') { $candidate = $Matches[1] }
    elseif ($trimmed -match '^([^\s"]+\.exe)$') { $candidate = $Matches[1] }
    if ($candidate -eq '' -or -not [IO.Path]::IsPathFullyQualified($candidate) -or
        -not (Test-QualificationPathWithin $candidate $InstallLocation)) {
        throw 'Insight UninstallString conflicts with the independent InstallLocation pointer'
    }
    $canonical = Get-QualificationCanonicalPath $candidate
    if ((Get-QualificationCanonicalPath (Split-Path -Parent $canonical)) -ne $InstallLocation) {
        throw 'Insight uninstaller is not a direct child of the independent InstallLocation pointer'
    }
    $item = Get-Item -LiteralPath $canonical -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Installed Insight uninstaller is not a regular file'
    }
    return $canonical
}

function Resolve-QualificationInstallState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$UninstallRoot,
        [Parameter(Mandatory)][string]$InstallPointerKey,
        [Parameter(Mandatory)][string]$ProductUninstallKey,
        [Parameter(Mandatory)][string[]]$AllowedDisplayNames,
        [Parameter(Mandatory)][string[]]$ExpectedVersions,
        [string[]]$ExcludedUninstallKeys = @(),
        [string]$RequiredUninstallKey = ''
    )

    $matches = @(Get-UninstallRecords $UninstallRoot | Where-Object {
        $_.Key -notin $ExcludedUninstallKeys -and
        (Test-QualificationProductRecord $_ $ProductUninstallKey $AllowedDisplayNames) -and
        ($RequiredUninstallKey -eq '' -or $_.Key -eq $RequiredUninstallKey)
    })
    if ($matches.Count -ne 1) {
        throw "Expected one current-user Insight uninstall record, found $($matches.Count)"
    }
    $record = $matches[0]
    if ($record.DisplayVersion -notin $ExpectedVersions) {
        throw 'Insight uninstall record has an unexpected version'
    }

    $pointer = Get-QualificationInstallPointer $InstallPointerKey
    if (-not $pointer.Exists) { throw 'Insight independent install pointer key is missing' }
    if ($pointer.InstallLocation -eq '') { throw 'Insight independent install pointer has no InstallLocation' }
    $installLocation = Get-QualificationCanonicalPath $pointer.InstallLocation
    $installItem = Get-Item -LiteralPath $installLocation -Force -ErrorAction Stop
    if (-not $installItem.PSIsContainer -or ($installItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Insight independent InstallLocation is not a regular directory'
    }

    if ($record.InstallLocation -ne '') {
        $uninstallLocation = Get-QualificationCanonicalPath $record.InstallLocation
        if ($uninstallLocation -ne $installLocation) {
            throw 'Insight uninstall record InstallLocation conflicts with the independent install pointer'
        }
    }
    $uninstaller = Resolve-QualificationUninstaller $record.UninstallString $installLocation

    return [PSCustomObject]@{
        Root = $record.Root
        Key = $record.Key
        InstallLocation = $installLocation
        UninstallInstallLocation = $record.InstallLocation
        DisplayVersion = $record.DisplayVersion
        DisplayName = $record.DisplayName
        DisplayIcon = $record.DisplayIcon
        UninstallString = $record.UninstallString
        Uninstaller = $uninstaller
    }
}

function Assert-QualificationInstallAbsent(
    [string]$UninstallRoot,
    [string]$InstallPointerKey,
    [string]$ProductUninstallKey,
    [string[]]$AllowedDisplayNames
) {
    $matches = @(Get-UninstallRecords $UninstallRoot | Where-Object {
        Test-QualificationProductRecord $_ $ProductUninstallKey $AllowedDisplayNames
    })
    if ($matches.Count -ne 0) { throw 'Insight uninstall record remained unexpectedly' }
    if ((Get-QualificationInstallPointer $InstallPointerKey).Exists) {
        throw 'Insight independent install pointer remained unexpectedly'
    }
}
