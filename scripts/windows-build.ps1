param([string]$IsccPath)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
Set-Location $sourceRoot
if ($env:JAZZRADIO_MAS -or $env:JAZZRADIO_DIRECT) {
    throw 'Use an ordinary Windows build environment without Apple signing variables.'
}
if ((& node -p "process.versions.node.split('.')[0]") -ne '24') {
    throw 'Packaging requires Node 24.'
}
if (-not $IsccPath) {
    $candidate = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($candidate) { $IsccPath = $candidate.Source }
}
if (-not $IsccPath) {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath)) {
    throw 'Install Inno Setup from https://jrsoftware.org/isdl.php or provide -IsccPath.'
}
# ISCC's PE FileVersion/ProductVersion are placeholders. The compiler engine
# reports its actual version when reading a script, not in the /? banner.
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('JazzRadio-InnoProbe-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeRoot | Out-Null
try {
    $probe = Join-Path $probeRoot 'version.iss'
    @'
[Setup]
AppName=JazzRadio compiler check
AppVersion=0.0.0
CreateAppDir=no
Uninstallable=no
Output=no
OutputDir=
OutputManifestFile=
'@ | Set-Content -LiteralPath $probe -Encoding ascii
    $probeOutput = & $IsccPath $probe 2>&1
    $probeExit = $LASTEXITCODE
} finally {
    Remove-Item -LiteralPath $probeRoot -Recurse -Force
}
$engine = [regex]::Match(($probeOutput -join "`n"), 'Compiler engine version:\s+Inno Setup\s+(\d+\.\d+\.\d+)')
if ($probeExit -ne 0 -or -not $engine.Success) {
    throw "Could not verify Inno Setup engine version (exit $probeExit):`n$($probeOutput -join "`n")"
}
$compilerVersion = $engine.Groups[1].Value
Write-Output "Inno Setup compiler engine: $compilerVersion"
if ([version]$compilerVersion -lt [version]'6.3.0') {
    throw "Inno Setup $compilerVersion is too old; 6.3 or later is required for x64-compatible Windows support."
}
$manifest = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Windows version metadata requires a three-part numeric package version.'
}
$sourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not identify the source commit.' }
$changes = & git status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) {
    throw 'Release installers require a clean source checkout so the recorded commit matches the payload.'
}

& npm.cmd run package -- --platform=win32 --arch=x64
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
$appSource = Join-Path $sourceRoot 'out\JazzRadio-win32-x64'
foreach ($relative in @('JazzRadio.exe', 'resources\app.asar', 'resources\THIRD_PARTY_NOTICES.txt', 'LICENSE', 'LICENSES.chromium.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $appSource $relative))) {
        throw "Packaged application is missing $relative."
    }
}
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead((Join-Path $appSource 'JazzRadio.exe')))
try {
    $reader.BaseStream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    $reader.BaseStream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550 -or $reader.ReadUInt16() -ne 0x8664) {
        throw 'The packaged executable is not Windows x64.'
    }
} finally { $reader.Dispose() }

$installerOutput = Join-Path $sourceRoot 'out\installers'
New-Item -ItemType Directory -Path $installerOutput -Force | Out-Null
& $IsccPath "/DAppSource=$appSource" "/DAppVersion=$($manifest.version)" "/DSourceRoot=$sourceRoot" "/DInstallerOutput=$installerOutput" 'build\windows-installer.iss'
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
$basename = "JazzRadio-$($manifest.version)-windows-x64-setup"
$installer = Join-Path $installerOutput "$basename.exe"
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'NotSigned') { throw 'Unexpected installer signing state; inspect before distribution.' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $basename.exe" | Set-Content -LiteralPath (Join-Path $installerOutput "$basename.sha256") -Encoding ascii
@(
    "Product: JazzRadio $($manifest.version)"
    "Source commit: $sourceCommit"
    'Platform: Windows x64'
    "Electron: $($manifest.devDependencies.electron)"
    "Node: $(& node --version)"
    "Inno Setup: $compilerVersion"
    'Publisher signature: unsigned'
    "Installer SHA256: $hash"
) | Set-Content -LiteralPath (Join-Path $installerOutput "$basename.buildinfo.txt") -Encoding ascii
Write-Output "Created $basename.exe (unsigned), SHA256 $hash"
