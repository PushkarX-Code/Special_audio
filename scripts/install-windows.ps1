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

$installer = Join-Path $env:TEMP 'Special-Audio-windows-setup.exe'
Write-Host 'Downloading the latest Special Audio...' -ForegroundColor White
try {
  # Newest release under its fixed name. No GitHub API call, so no rate limit.
  Invoke-WebRequest "https://github.com/$repo/releases/latest/download/Special-Audio-windows-setup.exe" -OutFile $installer -UseBasicParsing
} catch {
  # Older releases only have the versioned file name: read the version from the
  # /releases/latest redirect (.../tag/v1.2.3) and build that name.
  $page = Invoke-WebRequest "https://github.com/$repo/releases/latest" -UseBasicParsing
  $final = if ($page.BaseResponse.ResponseUri) { $page.BaseResponse.ResponseUri.AbsoluteUri } else { $page.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
  $tag = $final.TrimEnd('/').Split('/')[-1]
  if ($tag -notlike 'v*') { throw "Could not find the Windows download. Check https://github.com/$repo/releases" }
  $version = $tag.Substring(1)
  Invoke-WebRequest "https://github.com/$repo/releases/download/$tag/Special.Audio_${version}_x64-setup.exe" -OutFile $installer -UseBasicParsing
}
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
