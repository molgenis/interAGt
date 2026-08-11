# Builds InterAGt with PyInstaller (build_win.ps1) and wraps it into a
# single-file Windows installer (dist\InterAGt-Setup.exe) using Inno Setup.
#
# Requires Inno Setup 6: https://jrsoftware.org/isdl.php
# (installs ISCC.exe, normally under "C:\Program Files (x86)\Inno Setup 6").

$ErrorActionPreference = "Stop"

& "$PSScriptRoot\build_win.ps1"

$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
    $defaultPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (Test-Path $defaultPath) {
        $iscc = Get-Item $defaultPath
    }
}
if (-not $iscc) {
    Write-Error "ISCC.exe (Inno Setup Compiler) not found. Install Inno Setup 6 from https://jrsoftware.org/isdl.php and re-run."
    exit 1
}

& $iscc.Source "$PSScriptRoot\installer_win.iss"

Write-Host "Installer created at dist\InterAGt-Setup.exe"
