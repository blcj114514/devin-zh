# Locate Devin.exe on this machine.
# Strategy: common paths -> uninstall registry -> running process -> Start Menu shortcut.
# Output: absolute path of Devin.exe on success (exit 0); nothing on failure (exit 1).
$ErrorActionPreference = 'SilentlyContinue'

$candidates = @(
  "$env:LOCALAPPDATA\Programs\Devin\Devin.exe",
  "$env:ProgramFiles\Devin\Devin.exe",
  "${env:ProgramFiles(x86)}\Devin\Devin.exe"
)
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath $c) { Write-Output $c; exit 0 }
}

# Uninstall registry entries
$roots = @(
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($r in $roots) {
  Get-ChildItem -Path $r -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
    if ($p -and $p.DisplayName -like '*Devin*' -and $p.InstallLocation) {
      $exe = Join-Path $p.InstallLocation 'Devin.exe'
      if (Test-Path -LiteralPath $exe) { Write-Output $exe; exit 0 }
    }
  }
}

# Running process
$proc = Get-Process -Name Devin -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($proc) { Write-Output $proc.Path; exit 0 }

# Start Menu shortcuts
$dirs = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Devin",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Devin"
)
$sh = New-Object -ComObject WScript.Shell
foreach ($d in $dirs) {
  if (Test-Path -LiteralPath $d) {
    Get-ChildItem -Path $d -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      $t = $sh.CreateShortcut($_.FullName).TargetPath
      if ($t -like '*Devin.exe' -and (Test-Path -LiteralPath $t)) { Write-Output $t; exit 0 }
    }
  }
}

exit 1
