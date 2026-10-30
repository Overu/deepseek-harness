<# Track only exact owned Windows process roots and their creation-time-bound descendants. #>

function Get-QualificationUtcMicrosecondTicks([DateTime]$Value) {
    [long]$ticks = $Value.ToUniversalTime().Ticks
    return $ticks - ($ticks % 10)
}

function Get-QualificationCimCreationMicrosecondTicks([object]$Row) {
    if ($Row.CreationDate -isnot [DateTime]) {
        throw 'Tracked process has no usable CIM creation time'
    }
    return Get-QualificationUtcMicrosecondTicks $Row.CreationDate
}

function New-QualificationProcessSnapshot(
    [object]$Row,
    [string]$OwnedRoot,
    [object]$Parent,
    [int]$Depth
) {
    $creationMicrosecondTicks = Get-QualificationCimCreationMicrosecondTicks $Row
    $path = ''
    if ($Row.ExecutablePath -is [string] -and $Row.ExecutablePath -ne '') {
        $path = Get-QualificationCanonicalPath $Row.ExecutablePath
    }
    if ($null -eq $Parent) {
        if ($path -eq '' -or -not (Test-QualificationPathWithin $path $OwnedRoot)) {
            throw 'Owned process root does not have an exact executable path in the installation root'
        }
    } else {
        if ([int]$Row.ParentProcessId -ne $Parent.ProcessId) {
            throw 'Tracked descendant no longer matches its CIM parent'
        }
        if ($Parent.CreationMicrosecondTicks -gt $creationMicrosecondTicks) {
            throw 'Tracked descendant predates its CIM parent'
        }
    }
    return [PSCustomObject]@{
        ProcessId = [int]$Row.ProcessId
        ParentProcessId = [int]$Row.ParentProcessId
        CreationMicrosecondTicks = $creationMicrosecondTicks
        Path = $path
        Depth = $Depth
    }
}

function Open-QualificationTrackedProcess([object]$Snapshot) {
    $process = Get-Process -Id $Snapshot.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    try {
        if ($process.HasExited) {
            $process.Dispose()
            return $null
        }
        # Process.Handle opens and retains the native handle before any identity field is trusted.
        [void]$process.Handle
        if ((Get-QualificationUtcMicrosecondTicks $process.StartTime) -ne $Snapshot.CreationMicrosecondTicks) {
            throw 'Live process creation time does not match its CIM snapshot'
        }
        if ($Snapshot.Path -ne '') {
            $actualPath = $process.Path
            if ([string]::IsNullOrEmpty($actualPath)) {
                if ($process.HasExited) {
                    $process.Dispose()
                    return $null
                }
                throw 'Live process path is unavailable for a known CIM executable path'
            }
            if ((Get-QualificationCanonicalPath $actualPath) -ne $Snapshot.Path) {
                throw 'Live process path does not match its CIM snapshot'
            }
        }
        return [PSCustomObject]@{
            Process = $process
            ProcessId = $Snapshot.ProcessId
            CreationMicrosecondTicks = $Snapshot.CreationMicrosecondTicks
            Path = $Snapshot.Path
            Depth = $Snapshot.Depth
        }
    } catch [InvalidOperationException] {
        if ($process.HasExited) {
            $process.Dispose()
            return $null
        }
        $process.Dispose()
        throw
    } catch {
        $process.Dispose()
        throw
    }
}

function Assert-QualificationTrackedProcessIdentity([object]$Identity) {
    $process = $Identity.Process
    try {
        if ($process.HasExited) { return $false }
        if ((Get-QualificationUtcMicrosecondTicks $process.StartTime) -ne $Identity.CreationMicrosecondTicks) {
            throw 'Refused to stop a process whose creation time changed'
        }
        if ($Identity.Path -ne '') {
            $actualPath = $process.Path
            if ([string]::IsNullOrEmpty($actualPath)) {
                if ($process.HasExited) { return $false }
                throw 'Refused to stop a live process whose known path became unavailable'
            }
            if ((Get-QualificationCanonicalPath $actualPath) -ne $Identity.Path) {
                throw 'Refused to stop a process whose executable path changed'
            }
        }
        return $true
    } catch [InvalidOperationException] {
        if ($process.HasExited) { return $false }
        throw
    }
}

function Stop-QualificationTrackedProcess([object]$Identity, [int]$WaitMilliseconds) {
    if (-not (Assert-QualificationTrackedProcessIdentity $Identity)) { return }
    try {
        $Identity.Process.Kill()
    } catch [InvalidOperationException] {
        if ($Identity.Process.HasExited) { return }
        throw
    }
    if (-not $Identity.Process.WaitForExit($WaitMilliseconds)) {
        throw 'Owned Insight process did not exit after termination'
    }
}

function Get-QualificationOwnedProcessIdentities([string]$InstallRoot) {
    $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $children = @{}
    $roots = [Collections.Generic.List[object]]::new()
    foreach ($row in $rows) {
        $parentKey = [string]$row.ParentProcessId
        if (-not $children.ContainsKey($parentKey)) { $children[$parentKey] = [Collections.Generic.List[object]]::new() }
        $children[$parentKey].Add($row)
        if ($row.ExecutablePath -is [string] -and $row.ExecutablePath -ne '' -and
            (Test-QualificationPathWithin $row.ExecutablePath $InstallRoot)) {
            $roots.Add($row)
        }
    }

    $queue = [Collections.Generic.List[object]]::new()
    foreach ($root in $roots) {
        $queue.Add([PSCustomObject]@{ Row = $root; Parent = $null; ParentChainBound = $true; Depth = 0 })
    }
    $seen = [Collections.Generic.HashSet[int]]::new()
    $identities = [Collections.Generic.List[object]]::new()
    try {
        for ($index = 0; $index -lt $queue.Count; $index++) {
            $entry = $queue[$index]
            $processId = [int]$entry.Row.ProcessId
            if (-not $seen.Add($processId)) { continue }
            $snapshot = New-QualificationProcessSnapshot $entry.Row $InstallRoot $entry.Parent ([int]$entry.Depth)
            $identity = Open-QualificationTrackedProcess $snapshot
            if ($null -ne $identity) {
                if (-not $entry.ParentChainBound) {
                    $identity.Process.Dispose()
                    throw 'Live tracked descendant has an unbound CIM parent chain'
                }
                $identities.Add($identity)
            }
            $chainBound = $entry.ParentChainBound -and $null -ne $identity
            $childRows = $children[[string]$processId]
            if ($null -ne $childRows) {
                foreach ($child in $childRows) {
                    $queue.Add([PSCustomObject]@{
                        Row = $child
                        Parent = $snapshot
                        ParentChainBound = $chainBound
                        Depth = [int]$entry.Depth + 1
                    })
                }
            }
        }
        return @($identities)
    } catch {
        foreach ($identity in $identities) { $identity.Process.Dispose() }
        throw
    }
}
