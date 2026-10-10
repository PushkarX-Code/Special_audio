# Installs (or updates) Special Audio on Windows from the latest GitHub release.
#
#   irm https://raw.githubusercontent.com/PushkarX-Code/Special_audio/main/scripts/install-windows.ps1 | iex
#
# Downloading with PowerShell skips the browser's "downloaded from the internet" mark, so the
# installer runs without the SmartScreen prompt. It installs for the current user only (no admin).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'PushkarX-Code/Special_audio'

Write-Host 'Finding the latest Special Audio release...' -ForegroundColor White
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'special-audio-installer' }
$asset = $release.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
if (-not $asset) { throw "Could not find the Windows download. Check https://github.com/$repo/releases" }

$installer = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $installer -UseBasicParsing
Unblock-File $installer

Write-Host 'Installing...'
Get-Process -Name 'special-audio', 'Special Audio' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $installer -ArgumentList '/S' -Wait
Remove-Item $installer -Force -ErrorAction SilentlyContinue

# The installer puts the app in %LOCALAPPDATA%\Special Audio. Find its exe (not the uninstaller) and open it.
$dir = Join-Path $env:LOCALAPPDATA 'Special Audio'
$exe = Get-ChildItem $dir -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'uninstall*' } | Select-Object -First 1
if ($exe) {
  Write-Host 'Done. Opening Special Audio...' -ForegroundColor Green
  Start-Process $exe.FullName
} else {
  Write-Host 'Done. Open Special Audio from the Start menu.' -ForegroundColor Green
}
