#ifndef AppSource
  #error AppSource must point to the packaged Windows x64 application.
#endif
#ifndef AppVersion
  #error AppVersion must match package.json.
#endif
#ifndef SourceRoot
  #error SourceRoot must point to the source checkout.
#endif
#ifndef InstallerOutput
  #error InstallerOutput must point to the installer output directory.
#endif

[Setup]
AppId={{36DDA264-0131-4482-BDEF-17E1C358D037}
AppName=JazzRadio
AppVersion={#AppVersion}
AppPublisher=JazzRadio
AppPublisherURL=https://jazzradio.net/
AppSupportURL=https://jazzradio.net/
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany=JazzRadio
VersionInfoDescription=JazzRadio Setup
DefaultDirName={localappdata}\Programs\JazzRadio
DefaultGroupName=JazzRadio
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#InstallerOutput}
OutputBaseFilename=JazzRadio-{#AppVersion}-windows-x64-setup
SetupIconFile={#SourceRoot}\assets\app.ico
UninstallDisplayIcon={app}\JazzRadio.exe
UninstallDisplayName=JazzRadio
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\JazzRadio"; Filename: "{app}\JazzRadio.exe"; Check: not WizardNoIcons
Name: "{autodesktop}\JazzRadio"; Filename: "{app}\JazzRadio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\JazzRadio.exe"; Description: "{cm:LaunchProgram,JazzRadio}"; Flags: nowait postinstall skipifsilent unchecked
