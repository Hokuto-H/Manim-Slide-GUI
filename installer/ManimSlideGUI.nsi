; Manim Slide GUI のインストーラー（NSIS 3。installer/build_installer.py が makensis で作る）
;
; - このユーザーだけに入れる（管理者の権限は要らない）。既定の場所は %LOCALAPPDATA%\Programs\ManimSlideGUI
;   （ユーザー名に日本語・空白があるときは C:\ManimSlideGUI。conda の環境・TeX がうまく動かないことがあるため）
; - インストーラーにはアプリのファイルだけを入れ、Python などの部品（conda-forge）とフォント・TeX Live は、入れるときに取得する
; - 新しい版のインストーラーを実行すると、同じ場所を更新する（プロジェクト・ユーザーの設定はそのまま）

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !error "STAGE（アプリのファイルを並べたフォルダ）を -DSTAGE= で渡してください"
!endif
!ifndef OUTFILE
  !define OUTFILE "ManimSlideGUI-Setup-${VERSION}.exe"
!endif

!define APPNAME "Manim Slide GUI"
!define APPID "ManimSlideGUI"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!define MM_URL "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64"

Unicode true
Target amd64-unicode
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
ShowInstDetails show
ShowUninstDetails show
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1041 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1041 "FileDescription" "${APPNAME} のインストーラー"
VIAddVersionKey /LANG=1041 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "LegalCopyright" "${APPNAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION} のセットアップ"
!define MUI_WELCOMEPAGE_TEXT "数式とアニメーションのスライドを作るアプリ「${APPNAME}」を、このユーザーに入れます（管理者の権限は要りません）。$\r$\n$\r$\n\
入れるときに、インターネットから次のものを取得します。$\r$\n\
  ・アプリが使う部品（Python・Manim など。約 450 MB）$\r$\n\
  ・日本語フォント（Noto Sans JP・Noto Serif JP。入っていなければ）$\r$\n\
  ・TeX Live（数式の組版。見つからないときは、入れるかを聞きます。約 1 GB）$\r$\n$\r$\n\
すでに入れている場合は、新しい版に更新します。プロジェクトと設定はそのまま残ります。$\r$\n$\r$\n\
インターネットにつないだ状態で「次へ」を押してください。"
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "${APPNAME} を起動する"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\app\docs\manual\manual.pdf"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "説明書（PDF）を開く"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Japanese"

Var MM        ; micromamba.exe
Var PY        ; 環境の python.exe

; ---------------------------------------------------------------- 補助

; 文字列が ASCII の印字できる文字だけ（空白も無し）かを PowerShell で調べる。$0 = 0 なら OK
!macro CheckPlainPath PATH
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "if ('${PATH}' -match '^[\x21-\x7E]+$$') { exit 0 } else { exit 1 }"`
  Pop $0
!macroend

; アプリが動いていないかを確かめる（動いている間は、部品のファイルを書き換えられない）
!macro WAIT_FN PREFIX
Function ${PREFIX}WaitAppClosed
  wait_again:
  IfFileExists "$LOCALAPPDATA\${APPID}\instance.json" 0 wait_done
  MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "${APPNAME} が動いているようです。アプリの窓を閉じてから「再試行」を押してください。$\r$\n（閉じているのにこの表示が出るときは「無視」を押してください）" IDRETRY wait_again IDIGNORE wait_done
  Abort
  wait_done:
FunctionEnd
!macroend
!insertmacro WAIT_FN ""
!insertmacro WAIT_FN "un."

; 取得（Windows 10 以降の curl.exe。無ければ PowerShell）
!macro Download URL DEST
  ${If} ${FileExists} "$SYSDIR\curl.exe"
    nsExec::ExecToLog `"$SYSDIR\curl.exe" -fSL --retry 3 --retry-delay 3 -o "${DEST}" "${URL}"`
  ${Else}
    nsExec::ExecToLog `powershell -NoProfile -NonInteractive -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -UseBasicParsing -Uri '${URL}' -OutFile '${DEST}'"`
  ${EndIf}
  Pop $0
!macroend

Function .onInit
  ; 前に入れた場所があれば、そこを更新する
  ReadRegStr $0 HKCU "Software\${APPID}" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
    Return
  ${EndIf}
  !insertmacro CheckPlainPath "$LOCALAPPDATA"
  ${If} $0 != 0
    StrCpy $INSTDIR "C:\${APPID}"
  ${EndIf}
FunctionEnd

Function DirLeave
  !insertmacro CheckPlainPath "$INSTDIR"
  ${If} $0 != 0
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "入れる場所に、日本語などの文字か空白が入っています。$\r$\n部品（Python・Manim）が正しく動かないことがあるので、C:\${APPID} のような場所をおすすめします。$\r$\n$\r$\nこのまま続けますか？" IDYES dir_ok
      Abort
    dir_ok:
  ${EndIf}
FunctionEnd

Function LaunchApp
  Exec `"$INSTDIR\env\pythonw.exe" "$INSTDIR\app\launcher.pyw"`
FunctionEnd

; ---------------------------------------------------------------- 入れるもの

Section "-本体" SecMain
  SectionIn RO
  Call WaitAppClosed
  SetOutPath "$INSTDIR"
  File "icon.ico"

  DetailPrint "アプリのファイルを入れます…"
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR\app"
  File /r "${STAGE}\*.*"

  ; ---- micromamba（conda の部品を入れる道具。1 つの exe）
  StrCpy $MM "$INSTDIR\mamba\micromamba.exe"
  CreateDirectory "$INSTDIR\mamba"
  ${IfNot} ${FileExists} "$MM"
    DetailPrint "部品を入れる道具（micromamba）を取得します…"
    !insertmacro Download "${MM_URL}" "$MM"
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "micromamba を取得できませんでした（$0）。インターネットへの接続を確かめて、もう一度インストーラーを実行してください。"
      Abort
    ${EndIf}
  ${EndIf}

  ; ---- conda 環境（Python・Manim・Qt など。conda-forge から）
  System::Call 'Kernel32::SetEnvironmentVariable(t "MAMBA_NO_PROGRESS_BARS", t "1")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "NO_COLOR", t "1")'
  StrCpy $PY "$INSTDIR\env\python.exe"
  ${If} ${FileExists} "$PY"
    DetailPrint "部品を更新します（数分かかることがあります）…"
    nsExec::ExecToLog `"$MM" install -y -r "$INSTDIR\mamba" -p "$INSTDIR\env" -f "$INSTDIR\app\environment.conda.yml"`
  ${Else}
    DetailPrint "部品（Python・Manim など、約 450 MB）を取得して入れます。10〜20 分ほどかかります…"
    nsExec::ExecToLog `"$MM" create -y -r "$INSTDIR\mamba" -p "$INSTDIR\env" -f "$INSTDIR\app\environment.conda.yml"`
  ${EndIf}
  Pop $0
  ${If} $0 != 0
  ${OrIfNot} ${FileExists} "$PY"
    MessageBox MB_ICONSTOP "部品を入れられませんでした（$0）。インターネットへの接続を確かめて、もう一度インストーラーを実行してください。$\r$\n詳細の欄の最後に、理由が出ています。"
    Abort
  ${EndIf}

  DetailPrint "pip の部品を入れます…"
  nsExec::ExecToLog `"$PY" "$INSTDIR\app\installer\post_install.py" pip --install "$INSTDIR"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "部品（manim-slides）を入れられませんでした（$0）。もう一度インストーラーを実行してください。"
    Abort
  ${EndIf}

  DetailPrint "起動の設定を記録します…"
  nsExec::ExecToLog `"$PY" "$INSTDIR\app\installer\post_install.py" activation --install "$INSTDIR" --micromamba "$MM"`
  Pop $0

  DetailPrint "取得した部品の一時ファイルを消します…"
  nsExec::ExecToLog `"$MM" clean -a -y -r "$INSTDIR\mamba"`
  Pop $0

  ; ---- TeX（数式の組版）
  DetailPrint "TeX（xelatex）を探します…"
  nsExec::ExecToLog `"$PY" "$INSTDIR\app\installer\post_install.py" detect-tex --install "$INSTDIR"`
  Pop $0
  ${If} $0 == 2
    MessageBox MB_YESNO|MB_ICONQUESTION "数式を組むための TeX Live が見つかりません。$\r$\n今、入れますか？（日本語と数式に要る分。約 1 GB を取得し、30 分〜1 時間ほどかかります）$\r$\n$\r$\n「いいえ」を押すと、TeX Live は入れません（あとでこのインストーラーをもう一度実行すると、また聞きます）。" IDNO tex_skip
      DetailPrint "TeX Live を入れます（時間がかかります。この窓は閉じないでください）…"
      nsExec::ExecToLog `"$PY" "$INSTDIR\app\installer\post_install.py" install-tex --install "$INSTDIR"`
      Pop $0
      ${If} $0 != 0
        MessageBox MB_ICONEXCLAMATION "TeX Live を入れられませんでした（$0）。アプリは入れますが、数式の描画にはTeX Live が要ります。$\r$\nもう一度このインストーラーを実行すると、また入れられます。"
      ${EndIf}
      Goto tex_done
    tex_skip:
      DetailPrint "TeX Live は入れませんでした。"
    tex_done:
  ${EndIf}

  ; ---- ショートカット・アンインストール
  SetOutPath "$INSTDIR\app"
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\env\pythonw.exe" `"$INSTDIR\app\launcher.pyw"` "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "数式とアニメーションのスライドを作る"
  CreateShortCut "$SMPROGRAMS\${APPNAME} 説明書.lnk" "$INSTDIR\app\docs\manual\manual.pdf"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${APPID}" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" `"$INSTDIR\uninstall.exe"`
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" `"$INSTDIR\uninstall.exe" /S`
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
  DetailPrint "入れ終わりました。"
SectionEnd

Section "日本語フォント（Noto Sans JP・Noto Serif JP）" SecFonts
  DetailPrint "日本語フォントを確かめます…"
  nsExec::ExecToLog `"$PY" "$INSTDIR\app\installer\post_install.py" fonts --install "$INSTDIR"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "フォントを入れられませんでした（$0）。アプリは使えます（別のフォントで描きます）。"
  ${EndIf}
SectionEnd

Section "デスクトップにショートカットを作る" SecDesk
  SetOutPath "$INSTDIR\app"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\env\pythonw.exe" `"$INSTDIR\app\launcher.pyw"` "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "数式とアニメーションのスライドを作る"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "アプリと、アプリが使う部品（Python・Manim など）。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFonts} "アプリの既定のフォント。入っていなければ、このユーザーに入れます（約 20 MB）。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} "デスクトップに起動用のショートカットを置きます。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------- アンインストール（プロジェクト・ユーザーの設定・TeX Live・フォントは消さない）

Section "Uninstall"
  Call un.WaitAppClosed
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME} 説明書.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DetailPrint "アプリと部品を消します（少し時間がかかります）…"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\env"
  RMDir /r "$INSTDIR\mamba"
  Delete "$INSTDIR\activation.json"
  Delete "$INSTDIR\paths.json"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  ; ログと、アプリの窓の一時的なデータ（ユーザーの設定は %APPDATA%\ManimSlideGUI にあり、消さない）
  RMDir /r "$LOCALAPPDATA\${APPID}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APPID}"
  DetailPrint "プロジェクト・ユーザーの設定・TeX Live・フォントは残しています。"
SectionEnd
