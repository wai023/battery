$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Emit([hashtable]$payload) {
  $payload | ConvertTo-Json -Compress -Depth 3
}

$battery = $null
try {
  $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop | Select-Object -First 1
} catch {
  Emit @{ ok = $false; reason = 'wmi-failed' }
  exit 0
}

if ($null -eq $battery) {
  Emit @{ ok = $false; reason = 'no-battery' }
  exit 0
}

$status = 0
try { $status = [int]$battery.BatteryStatus } catch { $status = 0 }

$percent = 0
try { $percent = [int]$battery.EstimatedChargeRemaining } catch { $percent = 0 }
$percent = [Math]::Min(100, [Math]::Max(0, $percent))

# Win32_Battery status: 1 = discharging, 2 = on AC, 3 = fully charged, 6..9 = charging.
# Status 2 also appears when plugged in at 100%, so gate charging on the level.
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
  if ($t -gt 0 -and $t -lt 1440) { $minutes = $t }
}

$name = ''
try { $name = [string]$battery.Name } catch { $name = '' }

Emit @{
  ok = $true
  percent = $percent
  charging = $charging
  full = $full
  ac = $onAc
  minutes = $minutes
  name = $name
}
exit 0
