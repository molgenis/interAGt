; Inno Setup script for InterAGt.
; Wraps the PyInstaller onedir build (dist\InterAGt\) produced by build_win.ps1
; into a single-file Windows installer with a Start Menu shortcut and an
; optional desktop icon.
;
; Requires Inno Setup (https://jrsoftware.org/isinfo.php). Compile with:
;   ISCC.exe installer_win.iss
; or via package_win.ps1, which runs build_win.ps1 first.

#define MyAppName "InterAGt"
#define MyAppExeName "InterAGt.exe"
#define MyAppPublisher "InterAGt"

[Setup]
AppId={{B5B8B9C4-6E9B-4B7B-9B0E-6C8F9F6A5A5A}
AppName={#MyAppName}
AppVersion=1.0.0
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=InterAGt-Setup
SetupIconFile=..\resources\icons\icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\InterAGt\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
