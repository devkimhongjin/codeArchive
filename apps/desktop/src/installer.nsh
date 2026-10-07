!include "nsDialogs.nsh"
; Shortcuts are optional at install time, but uninstall must still remove those created.
!ifdef BUILD_UNINSTALLER
  !ifdef DO_NOT_CREATE_DESKTOP_SHORTCUT
    !undef DO_NOT_CREATE_DESKTOP_SHORTCUT
  !endif
  !ifdef DO_NOT_CREATE_START_MENU_SHORTCUT
    !undef DO_NOT_CREATE_START_MENU_SHORTCUT
  !endif
!endif
!ifndef BUILD_UNINSTALLER
Var desktopChoice
Var menuChoice
Var launchChoice

!macro customFinishPage
  Page custom CodeArchiveFinish CodeArchiveFinishLeave

Function CodeArchiveFinish
  ; Automatic upgrades preserve the existing shortcuts and do not prompt.
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "CodeArchive 설치 완료" "바로가기와 앱 실행 여부를 선택하세요."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u "CodeArchive 설치가 완료되었습니다. 확장 프로그램은 앱을 처음 실행할 때 안내에 따라 등록하세요."
  Pop $0
  ${NSD_CreateCheckbox} 0 45u 100% 15u "바탕 화면에 바로가기 만들기"
  Pop $desktopChoice
  ${NSD_SetState} $desktopChoice ${BST_CHECKED}
  ${NSD_CreateCheckbox} 0 70u 100% 15u "시작 메뉴에 바로가기 만들기"
  Pop $menuChoice
  ${NSD_SetState} $menuChoice ${BST_CHECKED}
  ${NSD_CreateCheckbox} 0 100u 100% 15u "CodeArchive 실행"
  Pop $launchChoice
  ${NSD_SetState} $launchChoice ${BST_CHECKED}
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:완료"
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

Function CodeArchiveFinishLeave
  ${NSD_GetState} $desktopChoice $0
  ${If} $0 == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  ${NSD_GetState} $menuChoice $0
  ${If} $0 == ${BST_CHECKED}
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
  ${NSD_GetState} $launchChoice $0
  ${If} $0 == ${BST_CHECKED}
    ${StdUtils.ExecShellAsUser} $0 "$appExe" "open" ""
  ${EndIf}
FunctionEnd
!macroend
!endif
