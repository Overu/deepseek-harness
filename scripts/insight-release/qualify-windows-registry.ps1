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
