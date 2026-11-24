param([switch]$Serve)

# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI without a BOM,
# and a multibyte character ending in 0x60 can escape the newline and break parsing.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Emit([hashtable]$payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}

# Full charge capacity rarely changes; cache it for 10 minutes instead of querying CIM every poll.
$script:FullCapacity = 0
$script:FullCapacityAt = [DateTime]::MinValue

function Get-FullCapacity {
  if ($script:FullCapacity -gt 0 -and ([DateTime]::Now - $script:FullCapacityAt).TotalMinutes -lt 10) {
    return $script:FullCapacity
  }
  try {
    $cap = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction Stop |
      Select-Object -First 1
    $script:FullCapacity = [double]$cap.FullChargedCapacity
    $script:FullCapacityAt = [DateTime]::Now
  } catch {
    $script:FullCapacity = 0
  }
  return $script:FullCapacity
}

function Read-Battery {
  $battery = $null
  try {
    $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop | Select-Object -First 1
  } catch {
    return @{ ok = $false; reason = 'wmi-failed' }
  }
  if ($null -eq $battery) { return @{ ok = $false; reason = 'no-battery' } }

  $status = 0
  try { $status = [int]$battery.BatteryStatus } catch { $status = 0 }

  $percent = 0
  try { $percent = [int]$battery.EstimatedChargeRemaining } catch { $percent = 0 }
  $percent = [Math]::Min(100, [Math]::Max(0, $percent))

  # Win32_Battery status: 1 = discharging, 2 = on AC, 3 = fully charged, 6..9 = charging.
  # Status 2 also shows up when plugged in at 100%, so gate charging on the level.
  $onAc = $status -ne 1
  $full = ($status -eq 3) -or ($onAc -and $percent -ge 100)
  $charging = ((($status -eq 2) -or ($status -ge 6 -and $status -le 9))) -and (-not $full)

  $minutes = $null
  if ($charging) {
    $t = 0
    try { $t = [int]$battery.TimeToFullCharge } catch { $t = 0 }
    if ($t -gt 0 -and $t -lt 1440) { $minutes = $t }
  } else {
    $t = 0
    try { $t = [int]$battery.EstimatedRunTime } catch { $t = 0 }
    # Sentinels such as 71582788 mean "unknown"; drop them.
    if ($t -gt 0 -and $t -lt 1440) { $minutes = $t }
  }

  $name = ''
  try { $name = [string]$battery.Name } catch { $name = '' }

  # Charge / discharge rate only lives in root\wmi; some drivers leave it empty, so it stays null.
  $watts = $null
  $minutesToFull = $null
  try {
    $bms = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction Stop |
      Select-Object -First 1
    if ($null -ne $bms) {
      $rate = 0
      if ($charging) {
        try { $rate = [double]$bms.ChargeRate } catch { $rate = 0 }
      } else {
        try { $rate = [double]$bms.DischargeRate } catch { $rate = 0 }
      }
      if ($rate -gt 0 -and $rate -lt 300000) {
        $watts = [Math]::Round($rate / 1000, 1)
        if ($charging) {
          $cap = Get-FullCapacity
          $remain = 0
          try { $remain = [double]$bms.RemainingCapacity } catch { $remain = 0 }
          if ($cap -gt 0 -and $remain -gt 0 -and $cap -gt $remain) {
            $m = [int][Math]::Ceiling((($cap - $remain) / $rate) * 60)
            if ($m -gt 0 -and $m -lt 1440) { $minutesToFull = $m }
          }
        }
      }
    }
  } catch {
    # root\wmi unavailable: we only lose the wattage, the level itself is fine.
  }

  return @{
    ok = $true
    percent = $percent
    charging = $charging
    full = $full
    ac = $onAc
    minutes = $minutes
    minutesToFull = $minutesToFull
    watts = $watts
    name = $name
  }
}

if ($Serve) {
  # Serve mode: one JSON line back for every line the host writes; QUIT or a closed stdin exits.
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq 'QUIT') { break }
    try {
      Emit (Read-Battery)
    } catch {
      Emit @{ ok = $false; reason = 'read-failed' }
    }
  }
}
else {
  Emit (Read-Battery)
}
