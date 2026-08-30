; ============================================================================
;  Auto Fish - установщик CEP-панели для Adobe Premiere Pro
;  Собирается через installer\build.bat (Inno Setup 6).
;  Ставит без прав администратора в папку пользователя.
; ============================================================================

#define MyAppName "Auto Fish"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Kirill Fomenok"
#define MyAppURL "https://github.com/keriklamar/auto-fish"

[Setup]
AppId={{9C6E5A2F-1D3B-4A7C-9E2D-AF10C0DE2000}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={userappdata}\Adobe\CEP\extensions\auto_fish
DisableDirPage=yes
DisableProgramGroupPage=yes
UninstallDisplayName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=AutoFishSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
InfoAfterFile=after_install.txt

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; чистая переустановка + снос старой панели-моста эпохи PyQt
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\Adobe\CEP\extensions\auto_fish_bridge"

[Files]
Source: "staging\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Registry]
; PlayerDebugMode=1 разрешает Premiere грузить неподписанное расширение.
; Ключ общий для всех CEP-расширений — при удалении НЕ трогаем.
Root: HKCU; Subkey: "Software\Adobe\CSXS.6";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.7";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.8";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := (MsgBox(
    'Перед установкой закрой Adobe Premiere Pro, если он сейчас открыт.' + #13#10#13#10 +
    'Продолжить установку?',
    mbConfirmation, MB_OKCANCEL) = IDOK);
end;
