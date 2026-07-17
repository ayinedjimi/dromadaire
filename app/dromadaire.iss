; Inno Setup Installer for Dromadaire par INTELLIGENCE PRIVEE
; Fork de confidentialite base sur Ollama — aucune telemetrie, aucun cloud
;
; Build:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DARCH=amd64 .\dromadaire.iss

#define MyAppName "Dromadaire"
#define MyAppVersion "7.9.0"
#define MyAppPublisher "INTELLIGENCE PRIVEE"
#define MyAppURL "https://github.com/ayinedjimi/dromadaire"
#define MyAppExeName "dromadaire.exe"
#define MyServerExeName "ollama.exe"
#define MyIcon ".\assets\app.ico"

[Setup]
AppId={{B7F3A2E1-9D4C-4E5F-A8B6-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=DromadaireSetup
SetupIconFile={#MyIcon}
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/ultra64
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=8
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
OutputDir=..\dist\

SetupLogging=yes
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no

WizardSmallImageFile=.\assets\setup.bmp

; Windows 10 minimum
MinVersion=10.0.10240

; Pages simplifiees pour installation rapide
DisableDirPage=no
DisableFinishedPage=no
DisableReadyMemo=yes
DisableReadyPage=yes
DisableStartupPrompt=yes

SetupMutex=DromadaireSetupMutex

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[LangOptions]
DialogFontSize=12

[Tasks]
Name: "desktopicon"; Description: "Creer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"; Flags: checkedonce

[Files]
; Application GUI Dromadaire
Source: "..\dist\dromadaire.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion 64bit; BeforeInstall: TaskKill('{#MyAppExeName}')

; Serveur Ollama (moteur d'inference)
Source: "..\dist\windows-amd64\ollama.exe"; DestDir: "{app}"; DestName: "{#MyServerExeName}"; Flags: ignoreversion 64bit; BeforeInstall: TaskKill('{#MyServerExeName}')

; Bibliotheques backend (CPU, CUDA, etc.)
Source: "..\dist\windows-amd64\lib\ollama\*"; DestDir: "{app}\lib\ollama\"; Flags: ignoreversion 64bit recursesubdirs

; VC++ Redistributable (si necessaire)
#if FileExists("..\dist\windows-amd64\vc_redist.x64.exe")
Source: "..\dist\windows-amd64\vc_redist.x64.exe"; DestDir: "{tmp}"; Check: vc_redist_needed(); Flags: deleteafterinstall
#endif

; Modele d'embedding pre-bundle (snowflake-arctic-embed:33m, ~65 Mo)
; onlyifdoesntexist evite d'ecraser si le modele est deja present
#if DirExists("..\dist\bundled-models\manifests")
Source: "..\dist\bundled-models\manifests\*"; DestDir: "{%USERPROFILE}\.ollama\models\manifests\"; Flags: ignoreversion recursesubdirs createallsubdirs onlyifdoesntexist
Source: "..\dist\bundled-models\blobs\*"; DestDir: "{%USERPROFILE}\.ollama\models\blobs\"; Flags: ignoreversion onlyifdoesntexist
#endif

; Icone
Source: ".\assets\app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Menu Demarrer
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"

; Raccourci Bureau (optionnel)
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[InstallDelete]
Type: filesandordirs; Name: "{app}\lib\ollama"

[Run]
; Installer VC++ Redistributable si necessaire
#if FileExists("..\dist\windows-amd64\vc_redist.x64.exe")
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /passive /norestart"; Check: vc_redist_needed(); StatusMsg: "Installation des composants Visual C++..."; Flags: waituntilterminated
#endif

; Lancer Dromadaire apres installation
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer {#MyAppName}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/im ""{#MyAppExeName}"" /f /t"; Flags: runhidden
Filename: "taskkill"; Parameters: "/im ""{#MyServerExeName}"" /f /t"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c timeout 5"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{%TEMP}\ollama*"
Type: filesandordirs; Name: "{%LOCALAPPDATA}\Ollama"
Type: filesandordirs; Name: "{%LOCALAPPDATA}\Programs\Dromadaire"
Type: filesandordirs; Name: "{%USERPROFILE}\.ollama\history"

[Registry]
; Ajouter au PATH utilisateur
Root: HKCU; Subkey: "Environment"; \
    ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; \
    Check: NeedsAddPath('{app}')

[Messages]
WelcomeLabel1=Bienvenue dans l'installation de Dromadaire
WelcomeLabel2=Dromadaire v7.9 par INTELLIGENCE PRIVEE%n%nVotre assistant IA local et confidentiel.%nAucune telemetrie, aucune donnee envoyee.%n%nCliquez sur Suivant pour continuer.
FinishedHeadingLabel=Installation terminee
FinishedLabel=Dromadaire a ete installe avec succes.%n%nVous pouvez maintenant lancer l'application depuis le Bureau ou le menu Demarrer.

[Code]

function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER,
    'Environment',
    'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + ExpandConstant(Param) + ';', ';' + OrigPath + ';') = 0;
end;

{ --- Detection du VC++ Runtime --- }
const VCRTL_MIN_V1 = 14;
const VCRTL_MIN_V2 = 40;
const VCRTL_MIN_V3 = 33807;
const VCRTL_MIN_V4 = 0;

function vc_redist_needed(): Boolean;
var
  sRegKey: string;
  v1: Cardinal;
  v2: Cardinal;
  v3: Cardinal;
  v4: Cardinal;
begin
  sRegKey := 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64';
  if (RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Major', v1) and
      RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Minor', v2) and
      RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'Bld', v3) and
      RegQueryDWordValue(HKEY_LOCAL_MACHINE, sRegKey, 'RBld', v4)) then
  begin
    Log('VC Redist version: ' + IntToStr(v1) +
        '.' + IntToStr(v2) + '.' + IntToStr(v3) +
        '.' + IntToStr(v4));
    Result := not (
        (v1 > VCRTL_MIN_V1) or ((v1 = VCRTL_MIN_V1) and
         ((v2 > VCRTL_MIN_V2) or ((v2 = VCRTL_MIN_V2) and
          ((v3 > VCRTL_MIN_V3) or ((v3 = VCRTL_MIN_V3) and
           (v4 >= VCRTL_MIN_V4)))))));
  end
  else
    Result := TRUE;
end;

{ --- Taille du dossier modeles pour desinstallation --- }
function GetDirSize(Path: String): Int64;
var
  FindRec: TFindRec;
  FilePath: string;
  Size: Int64;
begin
  if FindFirst(Path + '\*', FindRec) then begin
    Result := 0;
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then begin
          FilePath := Path + '\' + FindRec.Name;
          if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then begin
            Size := GetDirSize(FilePath);
          end else begin
            Size := Int64(FindRec.SizeHigh) shl 32 + FindRec.SizeLow;
          end;
          Result := Result + Size;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end else begin
    Log(Format('Failed to list %s', [Path]));
    Result := -1;
  end;
end;

var
  DeleteModelsChecked: Boolean;
  ModelsDir: string;

procedure InitializeUninstallProgressForm();
var
  UninstallPage: TNewNotebookPage;
  UninstallButton: TNewButton;
  DeleteModelsCheckbox: TNewCheckBox;
  OriginalCancelButtonEnabled: Boolean;
  OriginalCancelButtonModalResult: Integer;
  ctrl: TWinControl;
  ModelsSize: Int64;
begin
  if not UninstallSilent then begin
    ctrl := UninstallProgressForm.CancelButton;
    UninstallButton := TNewButton.Create(UninstallProgressForm);
    UninstallButton.Parent := UninstallProgressForm;
    UninstallButton.Left := ctrl.Left - ctrl.Width - ScaleX(10);
    UninstallButton.Top := ctrl.Top;
    UninstallButton.Width := ctrl.Width;
    UninstallButton.Height := ctrl.Height;
    UninstallButton.TabOrder := ctrl.TabOrder;
    UninstallButton.Caption := 'Desinstaller';
    UninstallButton.ModalResult := mrOK;
    UninstallProgressForm.CancelButton.TabOrder := UninstallButton.TabOrder + 1;

    UninstallPage := TNewNotebookPage.Create(UninstallProgressForm);
    UninstallPage.Notebook := UninstallProgressForm.InnerNotebook;
    UninstallPage.Parent := UninstallProgressForm.InnerNotebook;
    UninstallPage.Align := alClient;
    UninstallProgressForm.InnerNotebook.ActivePage := UninstallPage;

    ctrl := UninstallProgressForm.StatusLabel;
    with TNewStaticText.Create(UninstallProgressForm) do begin
      Parent := UninstallPage;
      Top := ctrl.Top;
      Left := ctrl.Left;
      Width := ctrl.Width;
      Height := ctrl.Height;
      AutoSize := False;
      ShowAccelChar := False;
      Caption := '';
    end;

    if (DirExists(GetEnv('USERPROFILE') + '\.ollama\models\blobs')) then begin
      ModelsDir := GetEnv('USERPROFILE') + '\.ollama\models';
      ModelsSize := GetDirSize(ModelsDir);
    end;

    DeleteModelsCheckbox := TNewCheckBox.Create(UninstallProgressForm);
    DeleteModelsCheckbox.Parent := UninstallPage;
    DeleteModelsCheckbox.Top := ctrl.Top + ScaleY(30);
    DeleteModelsCheckbox.Left := ctrl.Left;
    DeleteModelsCheckbox.Width := ScaleX(400);
    if ModelsSize > 1024*1024*1024 then begin
      DeleteModelsCheckbox.Caption := 'Supprimer les modeles (' + IntToStr(ModelsSize/(1024*1024*1024)) + ' Go)';
    end else if ModelsSize > 1024*1024 then begin
      DeleteModelsCheckbox.Caption := 'Supprimer les modeles (' + IntToStr(ModelsSize/(1024*1024)) + ' Mo)';
    end else begin
      DeleteModelsCheckbox.Caption := 'Supprimer les modeles';
    end;
    DeleteModelsCheckbox.Checked := False;

    OriginalCancelButtonEnabled := UninstallProgressForm.CancelButton.Enabled;
    OriginalCancelButtonModalResult := UninstallProgressForm.CancelButton.ModalResult;

    UninstallProgressForm.PageNameLabel.Caption := '';
    UninstallProgressForm.PageDescriptionLabel.Caption := '';
    UninstallProgressForm.CancelButton.Enabled := True;
    UninstallProgressForm.CancelButton.ModalResult := mrCancel;

    if UninstallProgressForm.ShowModal = mrCancel then Abort;

    UninstallButton.Visible := False;
    UninstallProgressForm.CancelButton.Enabled := OriginalCancelButtonEnabled;
    UninstallProgressForm.CancelButton.ModalResult := OriginalCancelButtonModalResult;
    UninstallProgressForm.InnerNotebook.ActivePage := UninstallProgressForm.InstallingPage;

    DeleteModelsChecked := DeleteModelsCheckbox.Checked;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usDone then begin
    if DeleteModelsChecked then begin
      Log('Nettoyage des modeles demande');
      if (VarIsEmpty(ModelsDir)) then begin
        DelTree(GetEnv('USERPROFILE') + '\.ollama\models', True, True, True);
      end else begin
        DelTree(ModelsDir + '\blobs', True, True, True);
        DelTree(ModelsDir + '\manifests', True, True, True);
      end;
    end else begin
      Log('Conservation des modeles');
    end;
  end;
end;

procedure TaskKill(FileName: String);
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/f /im ' + '"' + FileName + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
