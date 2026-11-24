; M-NetPulse 安装包脚本（Inno Setup 6）
; 权限全部交给用户：可选“仅为我/所有用户”安装、自定义目录、可选组件
#define MyAppName "M-NetPulse"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "M-NetPulse"
#define MyAppExeName "MNetPulse.exe"

[Setup]
AppId={{8E5A2C41-9F3D-4B7E-A1C6-MNETPULSE120}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
; 用户可选择“仅为我安装”或“为所有用户安装”
PrivilegesRequiredOverridesAllowed=dialog commandline
DefaultDirName={autopf}\MNetPulse
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
AllowNoIcons=yes
OutputDir=dist\installer
OutputBaseFilename=MNetPulse-Setup-1.2.0
SetupIconFile=app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked
Name: "quicklaunchicon"; Description: "创建任务栏快捷方式"; GroupDescription: "附加任务："; Flags: unchecked; OnlyBelowVersion: 0,6.4
Name: "startupicon"; Description: "开机自动启动 M-NetPulse"; GroupDescription: "附加任务："; Flags: unchecked
Name: "addpath"; Description: "将安装目录加入 PATH 环境变量（命令行可直接运行 MNetPulse）"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "dist\portable\MNetPulse.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\portable\wwwroot\*"; DestDir: "{app}\wwwroot"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartmenu}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Registry]
; 可选：加入用户 PATH
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addpath; Check: NeedsAddPath('{app}')

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即运行 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 卸载时清理用户数据目录（仅当用户勾选时，见 Code 段）
Type: filesandordirs; Name: "{localappdata}\MNetPulse"

[Code]
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
  InstallDir: string;
begin
  InstallDir := ExpandConstant(Param);
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(InstallDir) + ';', ';' + Uppercase(OrigPath) + ';') = 0;
end;

// 卸载时询问是否保留用户数据
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  UserDataDir: string;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    UserDataDir := ExpandConstant('{localappdata}\MNetPulse');
    if DirExists(UserDataDir) then
    begin
      if MsgBox('是否同时删除流量统计数据（%LocalAppData%\MNetPulse）？' #13#10 +
                '选择「否」将保留数据，下次安装可继续使用。',
                mbConfirmation, MB_YESNO) = IDYES then
        DelTree(UserDataDir, True, True, True);
    end;
  end;
end;
