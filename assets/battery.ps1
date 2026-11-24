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
# Consecutive full reads that saw the cable in but no charge current. This laptop
# pauses charging for tens of seconds at a time while the charger re-negotiates, so
# one miss must not flip the page to "not charging".
$script:MissReads = 0
$script:MissLimit = 3
$script:LastPercent = $null
$script:LastCharging = $false
$script:LastWatts = $null
$script:LastMinutes = $null
$script:LastMinutesToFull = $null
# Charge rate comes in pulses on some drivers (0.9 W and 15.6 W a second apart), so
# both time estimates use the median of the last few full reads instead of one sample.
$script:ChargeRates = @()
$script:DischargeRates = @()
$script:ShownMinutesToFull = $null
# The median still steps when the pulse mix changes; a slow filter on top keeps the
# displayed estimate from chasing every step.
$script:SmoothRate = 0

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

# Median instead of mean: the pulse train is bimodal, so an average still walks
# around whenever a big pulse lands, while the middle value barely moves.
function Get-Median($values) {
  $list = @($values | Where-Object { $null -ne $_ })
  $n = $list.Count
  if ($n -eq 0) { return 0 }
  $sorted = @($list | Sort-Object)
  if ($n % 2 -eq 1) { return [double]$sorted[[int](($n - 1) / 2)] }
  $lo = [double]$sorted[[int]($n / 2) - 1]
  $hi = [double]$sorted[[int]($n / 2)]
  return ($lo + $hi) / 2
}

function Get-FullCapacity {  if ($script:FullCapacity -gt 0 -and ([DateTime]::Now - $script:FullCapacityAt).TotalMinutes -lt 10) {
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

# Pure decision, so the cases around a plug can be checked without a real cable.
# Order matters: pick the cable state first, then judge charging. Judging charging
# against the WMI cable bit and only later correcting the cable bit was the bug:
# right after a plug WMI still says "on battery", so charging came out false while
# ac came out true, and the page showed "on battery" with the cable in.
function Resolve-Power {
  param(
    [int]$Status,
    [int]$Percent,
    [bool]$HasOnline,
    [bool]$WmiOnline,
    [bool]$HasCharging,
    [bool]$WmiCharging,
    [double]$ChargeRate,
    [double]$DischargeRate,
    $KernelAc,
    [int]$MissCount = 0,
    [int]$MissLimit = 3
  )

  # Cable: kernel bit first (milliseconds), WMI second, BatteryStatus last.
  $onAc = $Status -ne 1
  if ($HasOnline) { $onAc = $WmiOnline }
  if ($null -ne $KernelAc) { $onAc = [bool]$KernelAc }

  $full = ($Status -eq 3) -or ($onAc -and $Percent -ge 100)

  $charging = $false
  $miss = 0
  if ($onAc -and -not $full) {
    if ($HasCharging) {
      $charging = $WmiCharging -or ($ChargeRate -gt 0 -and $DischargeRate -le 0)
    } else {
      $charging = ($Status -eq 2) -or ($Status -ge 6 -and $Status -le 9)
    }

    if ($charging) {
      $miss = 0
    } else {
      # Cable in but no current this round: hold the previous verdict for a couple of
      # reads before calling it "plugged in, not charging". Any charge current clears it.
      $miss = $MissCount + 1
      if ($miss -lt $MissLimit) { $charging = $true }
    }
  }

  return @{ ac = $onAc; full = $full; charging = $charging; miss = $miss }
}

function Read-Battery {
  $battery = $null
  try {
    $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop | Select-Object -First 1
  } catch {
    return @{ ok = $false; reason = 'wmi-failed' }
  }
  if ($null -eq $battery) { return @{ ok = $false; reason = 'no-battery' } }

  # root\wmi carries the driver's own Charging bit, which is the only reliable one:
  # Win32_Battery.BatteryStatus stays 2 ("on AC") while charging on most machines,
  # and the kernel BatteryFlag bit 8 is not set by every firmware (this laptop never
  # sets it while charging), so neither can decide on its own.
  $bms = $null
  try {
    $bms = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction Stop |
      Select-Object -First 1
  } catch {
    $bms = $null
  }

  $hasCharging = $false
  $wmiCharging = $false
  $hasOnline = $false
  $wmiOnline = $false
  $chargeRate = 0
  $dischargeRate = 0
  if ($null -ne $bms) {
    try { $wmiCharging = [bool]$bms.Charging; $hasCharging = $true } catch { $hasCharging = $false }
    try { $wmiOnline = [bool]$bms.PowerOnline; $hasOnline = $true } catch { $hasOnline = $false }
    try { $chargeRate = [double]$bms.ChargeRate } catch { $chargeRate = 0 }
    try { $dischargeRate = [double]$bms.DischargeRate } catch { $dischargeRate = 0 }
  }

  $status = 0
  try { $status = [int]$battery.BatteryStatus } catch { $status = 0 }

  $percent = 0
  try { $percent = [int]$battery.EstimatedChargeRemaining } catch { $percent = 0 }
  $percent = [Math]::Min(100, [Math]::Max(0, $percent))

  $kernel = Get-KernelPower
  $kernelAc = $null
  if ($null -ne $kernel -and $kernel.known -and -not $kernel.noBattery) {
    $kernelAc = [bool]$kernel.ac
  }

  $power = Resolve-Power -Status $status -Percent $percent `
    -HasOnline $hasOnline -WmiOnline $wmiOnline `
    -HasCharging $hasCharging -WmiCharging $wmiCharging `
    -ChargeRate $chargeRate -DischargeRate $dischargeRate `
    -KernelAc $kernelAc -MissCount $script:MissReads -MissLimit $script:MissLimit
  $onAc = $power.ac
  $full = $power.full
  $charging = $power.charging
  $script:MissReads = $power.miss

  $cap = Get-FullCapacity
  $remain = 0
  if ($null -ne $bms) {
    try { $remain = [double]$bms.RemainingCapacity } catch { $remain = 0 }
  }

  # Keep the last five readings of whichever direction is live. A real pause (cable in,
  # no current for MissLimit reads) drops the charge history so a replug is not
  # priced with the pulses from before.
  if ($charging -and $chargeRate -gt 0) {
    $script:ChargeRates = @((@($script:ChargeRates) + $chargeRate) | Select-Object -Last 9)
  }
  if (-not $onAc -and $dischargeRate -gt 0) {
    $script:DischargeRates = @((@($script:DischargeRates) + $dischargeRate) | Select-Object -Last 9)
  }
  if ($power.miss -ge $script:MissLimit) { $script:ChargeRates = @(); $script:SmoothRate = 0 }
  if ($onAc) { $script:DischargeRates = @() }

  $chargeMedian = Get-Median $script:ChargeRates
  $disMedian = Get-Median $script:DischargeRates

  $name = ''
  try { $name = [string]$battery.Name } catch { $name = '' }
  if ($name) { $script:Name = $name }

  # Charge / discharge rate only lives in root\wmi; some drivers leave it empty.
  $watts = $null
  if ($null -ne $bms) {
    $rate = 0
    if ($charging) { $rate = $chargeRate } else { $rate = $dischargeRate }
    if ($rate -gt 0 -and $rate -lt 300000) {
      $watts = [Math]::Round($rate / 1000, 1)
    }
  }

  $minutes = $null
  $minutesToFull = $null

  if ($charging) {
    if ($chargeMedian -gt 0 -and $cap -gt 0 -and $remain -gt 0 -and $cap -gt $remain) {
      if ($script:SmoothRate -le 0) { $script:SmoothRate = $chargeMedian }
      else { $script:SmoothRate = 0.65 * $script:SmoothRate + 0.35 * $chargeMedian }
      $m = [int][Math]::Ceiling((($cap - $remain) / $script:SmoothRate) * 60)
      if ($m -gt 0 -and $m -lt 1440) {
        # Whole five-minute steps: "3 小时 41 分" turning into "3 小时 38 分" is noise.
        $m = [int]([Math]::Round($m / 5) * 5)
        if ($m -lt 5) { $m = 5 }
        $shown = $script:ShownMinutesToFull
        # Deadband: only move the number once it is off by 8 minutes or 12%.
        if ($null -eq $shown -or [Math]::Abs($m - $shown) -ge [Math]::Max(8, 0.12 * $shown)) {
          $script:ShownMinutesToFull = $m
        }
        $minutesToFull = $script:ShownMinutesToFull
      }
    }
    # TimeToFullCharge is what the power plan promises; use it when no rate is known.
    if ($null -eq $minutesToFull) {
      $t = 0
      try { $t = [int]$battery.TimeToFullCharge } catch { $t = 0 }
      if ($t -gt 0 -and $t -lt 1440) { $minutesToFull = $t }
    }
  } else {
    $script:ShownMinutesToFull = $null
    # While the cable is in but the battery is not taking current, the discharge rate
    # is the charger arbitration noise, so any "remaining" number would be fiction.
    if (-not $onAc) {
      $t = 0
      try { $t = [int]$battery.EstimatedRunTime } catch { $t = 0 }
      # Sentinels such as 71582788 mean "unknown"; drop them.
      $win = $null
      if ($t -gt 0 -and $t -lt 1440) { $win = $t }

      $own = $null
      $ownRaw = $null
      if ($script:DischargeRates.Count -ge 2 -and $disMedian -gt 0 -and $remain -gt 0) {
        # Keep the raw value for the cross-check: capping it first would hide a wildly
        # optimistic median and let the system's own number slip through.
        $ownRaw = ($remain / $disMedian) * 60
        if ($ownRaw -gt 0 -and $ownRaw -lt 1440) { $own = [int][Math]::Ceiling($ownRaw) }
      }

      # Two estimates that differ by more than 3x mean the system one is garbage: this
      # laptop has reported 579 minutes at 45% while the pack holds about 3 hours.
      if ($null -ne $win -and $null -ne $ownRaw) {
        if ($win -gt 3 * $ownRaw -or $win -lt $ownRaw / 3) { $win = $null }
      }
      if ($null -ne $win) { $minutes = $win } elseif ($null -ne $own) { $minutes = $own }
    }
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
    # A fresh cable event always starts from a clean slate, so a replug reads as
    # charging at once instead of inheriting the misses from the last session.
    $script:MissReads = 0
    # Rates from the other power state must not price the new one.
    $script:ChargeRates = @()
    $script:DischargeRates = @()
    $script:ShownMinutesToFull = $null
    $script:SmoothRate = 0
  }
  $script:LastAc = $full.ac
  $script:LastPercent = $full.percent
  $script:LastCharging = $full.charging
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
  # The kernel charging bit lies on some firmware, so the 800 ms tick reuses the
  # state from the last full read. Only a cable event is guessed, and the full
  # read that follows within 1.5 s corrects it.
  $charging = $script:LastCharging
  if ($ac -ne $script:LastAc) { $charging = $ac -and (-not $full) }
  if ($full) { $charging = $false }

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
