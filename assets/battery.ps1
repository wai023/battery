param([switch]$Serve)

# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI without a BOM,
# and a multibyte character ending in 0x60 can escape the newline and break parsing.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Two kinds of reads:
#   PING  -> full WMI reading (level, capacity, wattage, remaining time), ~26 ms
#   POLL  -> AC line + level from kernel32, ~0.04 ms, reuses the cached wattage
# The kernel bits are what the taskbar power icon uses and flip in milliseconds,
# while Win32_Battery goes through WMI and can lag a second or two behind. That lag
# is why a plug/unplug used to show up late.
#
# Note: Console.In.ReadLineAsync is synchronous for a redirected pipe under .NET
# Framework, so the host polls on a timer instead of the script watching stdin
# on its own. Each POLL is one blocking ReadLine, which is fine.

$script:HasPower = $false
$script:Name = ''
$script:LastAc = $null
$script:LastPercent = $null
$script:LastWatts = $null
$script:LastMinutes = $null
$script:LastMinutesToFull = $null

$script:FullCapacity = 0
$script:FullCapacityAt = [DateTime]::MinValue

# id 0 marks a snapshot the script pushes on its own; the host answers requests
# with the id it was given, so a push can never be mistaken for a reply.
function Emit([hashtable]$payload, [int]$id = 0) {
  $payload['id'] = $id
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}

# Cheap read: about 0.04 ms, versus roughly 26 ms for one WMI query.
function Get-KernelPower {
  if (-not $script:HasPower) { return $null }
  $sp = New-Object SYSTEM_POWER_STATUS
  if (-not [RecPower]::GetSystemPowerStatus([ref]$sp)) { return $null }
  if ($sp.BatteryFlag -eq 128) { return @{ known = $true; noBattery = $true } }
  # 255 means unknown; fall back to WMI rather than guess.
  if ($sp.ACLineStatus -gt 1) { return $null }
  $percent = -1
  if ($sp.BatteryLifePercent -le 100) { $percent = [int]$sp.BatteryLifePercent }
  return @{
    known = $true
    noBattery = $false
    ac = ($sp.ACLineStatus -eq 1)
    chargingFlag = (($sp.BatteryFlag -band 8) -ne 0)
    percent = $percent
  }
}

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

  # WMI may still report the old AC state right after a plug/unplug; the kernel bit wins.
  $kernel = Get-KernelPower
  if ($null -ne $kernel -and $kernel.known -and -not $kernel.noBattery) {
    if ($kernel.ac -ne $onAc) { $onAc = $kernel.ac }
    if (-not $onAc) {
      $charging = $false
      $full = $false
    } elseif ($percent -ge 100) {
      $full = $true
      $charging = $false
    }
  }

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
  if ($name) { $script:Name = $name }

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

function Remember-Full([hashtable]$full) {
  if ($null -ne $script:LastAc -and $script:LastAc -ne $full.ac) {
    # The old wattage belonged to the other power state; drop it rather than lie.
    $script:LastWatts = $null
    $script:LastMinutes = $null
    $script:LastMinutesToFull = $null
  }
  $script:LastAc = $full.ac
  $script:LastPercent = $full.percent
  $script:LastWatts = $full.watts
  $script:LastMinutes = $full.minutes
  $script:LastMinutesToFull = $full.minutesToFull
  if ($full.name) { $script:Name = $full.name }
}

function Num($value) {
  if ($null -eq $value) { return 'null' }
  return [string]$value
}

function Bool($value) {
  if ($value) { return 'true' }
  return 'false'
}

# Hand-built JSON for the 800 ms tick: ConvertTo-Json would cost more than the read.
function Format-Quick([hashtable]$kernel, [int]$id) {
  if ($null -eq $kernel -or -not $kernel.known) { return $null }
  if ($kernel.noBattery) { return '{"id":' + $id + ',"ok":false,"reason":"no-battery"}' }

  # Level comes from the full read: kernel and WMI disagree by a point now and then,
  # and mixing the two makes the number flicker. The tick only tracks the AC line.
  $percent = $script:LastPercent
  if ($null -eq $percent) { $percent = $kernel.percent }
  if ($null -eq $percent -or $percent -lt 0) { return $null }

  $ac = $kernel.ac
  $full = $ac -and ($percent -ge 100)
  $charging = $kernel.chargingFlag -and (-not $full)

  # Keep the cached wattage only while the power state is unchanged; otherwise the
  # page would show "charging at 10 W" for a second after the cable is pulled.
  $watts = 'null'
  $minutes = 'null'
  $minutesToFull = 'null'
  if ($ac -eq $script:LastAc) {
    $watts = Num $script:LastWatts
    $minutes = Num $script:LastMinutes
    $minutesToFull = Num $script:LastMinutesToFull
  }

  $safeName = ''
  if ($script:Name) { $safeName = $script:Name.Replace('\', '\\').Replace('"', '\"') }

  return '{"id":' + $id + ',"quick":true,"ok":true,"percent":' + $percent +
    ',"charging":' + (Bool $charging) + ',"full":' + (Bool $full) + ',"ac":' + (Bool $ac) +
    ',"minutes":' + $minutes + ',"minutesToFull":' + $minutesToFull +
    ',"watts":' + $watts + ',"name":"' + $safeName + '"}'
}

if ($Serve) {
  # Serve mode: answer each line from the host. PING is a full read, POLL is the
  # cheap tick, QUIT or a closed stdin exits.

  # First reading goes out before anything else so the host never starts blind.
  $first = $null
  try { $first = Read-Battery } catch { $first = @{ ok = $false; reason = 'read-failed' } }
  Emit $first 0
  if ($first.ok) { Remember-Full $first }

  # Compile the P/Invoke type only now: the numbers are already out, so this wait
  # is invisible. If it fails we fall back to full reads on every tick.
  if (-not ('RecPower' -as [type])) {
    try {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct SYSTEM_POWER_STATUS
{
    public byte ACLineStatus;
    public byte BatteryFlag;
    public byte BatteryLifePercent;
    public byte SystemStatusFlag;
    public int BatteryLifeTime;
    public int BatteryFullLifeTime;
}

public static class RecPower
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
}
'@
      $script:HasPower = $true
    } catch {
      $script:HasPower = $false
    }
  }

  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $trim = $line.Trim()
    if ($trim -eq 'QUIT') { break }

    if ($trim -match '^POLL\s+(\d+)$') {
      $id = [int]$Matches[1]
      $quick = $null
      try { $quick = Format-Quick (Get-KernelPower) $id } catch { $quick = $null }
      if ($null -ne $quick) {
        [Console]::Out.WriteLine($quick)
        [Console]::Out.Flush()
      } else {
        # No kernel data: answer with a full read so the host still gets a snapshot.
        try { Emit (Read-Battery) $id } catch { Emit @{ ok = $false; reason = 'read-failed' } $id }
      }
      continue
    }

    $id = 0
    if ($trim -match '^PING\s+(\d+)$') { $id = [int]$Matches[1] }
    try {
      $full = Read-Battery
      Emit $full $id
      if ($full.ok) { Remember-Full $full }
    } catch {
      Emit @{ ok = $false; reason = 'read-failed' } $id
    }
  }
}
else {
  Emit (Read-Battery)
}
