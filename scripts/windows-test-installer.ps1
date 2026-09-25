param([string]$InstallerPath)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $InstallerPath) {
    $InstallerPath = Join-Path $sourceRoot "out\installers\JazzRadio-$version-windows-x64-setup.exe"
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$payload = Join-Path $sourceRoot 'out\JazzRadio-win32-x64'
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{36DDA264-0131-4482-BDEF-17E1C358D037}_is1'
foreach ($key in @("HKCU:\$uninstallKey", "HKLM:\$uninstallKey", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{36DDA264-0131-4482-BDEF-17E1C358D037}_is1")) {
    if (Test-Path $key) { throw 'An installed JazzRadio copy already exists; run installer tests on a clean account.' }
}
$testRoot = Join-Path $env:LOCALAPPDATA ('JazzRadioInstallerTest-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $testRoot 'app'
New-Item -ItemType Directory -Path $testRoot | Out-Null
$dataPath = Join-Path $env:APPDATA 'JazzRadio Berlin'
function DataSnapshot {
    if (-not (Test-Path -LiteralPath $dataPath)) { return 'absent' }
    return (@('settings.json', 'notes.json', 'favorites.json' | ForEach-Object {
        $file = Join-Path $dataPath $_
        if (Test-Path -LiteralPath $file) { $_ + ':' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
        else { $_ + ':absent' }
    }) -join "`n")
}
$beforeData = DataSnapshot
$beforeProcesses = @(Get-Process JazzRadio -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$testPassed = $false
try {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/RESTARTEXITCODE=3010', '/SP-', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/NOICONS', '/TASKS=""', "/DIR=`"$destination`"", "/LOG=`"$testRoot\install.log`"")
    $process = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer returned $($process.ExitCode)." }
    $registration = Get-ItemProperty "HKCU:\$uninstallKey"
    if ($registration.DisplayName -ne 'JazzRadio' -or $registration.Publisher -ne 'JazzRadio' -or $registration.DisplayVersion -ne $version) {
        throw 'Unexpected installed product identity.'
    }
    $installedAt = $registration.InstallLocation.TrimEnd('\')
    if ($installedAt -ne $destination.TrimEnd('\')) { throw 'Installer did not use the isolated destination.' }
    $count = 0
    Get-ChildItem -LiteralPath $payload -File -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($payload.Length).TrimStart('\')
        $installedFile = Join-Path $destination $relative
        if (-not (Test-Path -LiteralPath $installedFile)) { throw "Missing installed file: $relative" }
        if ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $installedFile).Hash) {
            throw "Installed file mismatch: $relative"
        }
        $count++
    }
    if ((DataSnapshot) -ne $beforeData) { throw 'Installation changed existing application data.' }
    $afterProcesses = @(Get-Process JazzRadio -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if ((($beforeProcesses | Sort-Object) -join ',') -ne (($afterProcesses | Sort-Object) -join ',')) {
        throw 'Installer unexpectedly started or stopped JazzRadio.'
    }
    Write-Output "Installed $count payload files with matching hashes, per-user registration, and no app launch."
    $testPassed = $true
} finally {
    $uninstaller = Join-Path $destination 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$testRoot\uninstall.log`"") -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstaller returned $($process.ExitCode). See $testRoot." }
    }
}
if (-not $testPassed) { throw 'Installation checks did not complete.' }
if (Test-Path "HKCU:\$uninstallKey") { throw 'Uninstall registration was not removed.' }
if (@(Get-ChildItem -LiteralPath $destination -File -Recurse -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Uninstall left application files behind.'
}
if ((DataSnapshot) -ne $beforeData) { throw 'Uninstallation changed existing application data.' }
Write-Output 'Silent uninstall passed; existing application data is unchanged. No playback or GUI QA was performed.'
