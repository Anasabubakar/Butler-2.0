# Updates the Butler pet on this Windows computer from your copy of the code, like
# update-pet on Linux: gets the latest code, builds the installer, and installs it.
# Needs Git and Node.js 22. Run it in PowerShell:
#   powershell -ExecutionPolicy Bypass -File desktop\windows\update-pet.ps1
# The installed app also updates itself from the GitHub releases once the repository is public.
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')

git -C $repo pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull failed: commit or stash your changes first.' }

Push-Location $here
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    npm run dist
    if ($LASTEXITCODE -ne 0) { throw 'Building the installer failed.' }
    $installer = Get-ChildItem -Path (Join-Path $here 'dist') -Filter 'butler-*-windows-setup.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'No installer was built.' }

    # Close the running pet, then install over it quietly. It starts again by itself.
    Get-Process -Name 'Butler' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
    Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\Butler\Butler.exe')
    Write-Host "Butler pet updated to $($installer.Name)."
} finally {
    Pop-Location
}
