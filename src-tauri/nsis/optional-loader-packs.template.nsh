!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var YwOptionalLoaderPacksPageVisited
Var YwMmdLoaderPackCheckbox
Var YwGaussianSplatLoaderPackCheckbox
Var YwInstallMmdLoaderPack
Var YwInstallGaussianSplatLoaderPack

Page custom YwOptionalLoaderPacksPage YwOptionalLoaderPacksPageLeave

Function YwOptionalLoaderPacksPage
  IfSilent 0 +2
    Abort

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/P" $R1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  StrCpy $YwOptionalLoaderPacksPageVisited "1"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "Choose optional loader packs to install with yw-look."
  Pop $0

  ${NSD_CreateCheckbox} 0 30u 100% 12u "MMD Loader Pack (.pmx, .pmd, .vmd)"
  Pop $YwMmdLoaderPackCheckbox
  IfFileExists "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd\manifest.json" 0 +2
    ${NSD_Check} $YwMmdLoaderPackCheckbox

  ${NSD_CreateCheckbox} 0 50u 100% 12u "Gaussian Splat Loader Pack (.splat, .spz, .ksplat, .sog)"
  Pop $YwGaussianSplatLoaderPackCheckbox
  IfFileExists "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\manifest.json" 0 +2
    ${NSD_Check} $YwGaussianSplatLoaderPackCheckbox

  ${NSD_CreateLabel} 0 74u 100% 28u "Unchecked packs are left out of the initial install. You can still install or remove first-party loader packs later from Settings."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function YwOptionalLoaderPacksPageLeave
  ${NSD_GetState} $YwMmdLoaderPackCheckbox $YwInstallMmdLoaderPack
  ${NSD_GetState} $YwGaussianSplatLoaderPackCheckbox $YwInstallGaussianSplatLoaderPack
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ${If} $YwOptionalLoaderPacksPageVisited == "1"
    ${If} $YwInstallMmdLoaderPack == ${BST_CHECKED}
      Call YwInstallMmdLoaderPack
    ${Else}
      Call YwRemoveMmdLoaderPack
    ${EndIf}

    ${If} $YwInstallGaussianSplatLoaderPack == ${BST_CHECKED}
      Call YwInstallGaussianSplatLoaderPack
    ${Else}
      Call YwRemoveGaussianSplatLoaderPack
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$APPDATA\com.yohawing.ywlook\optional-loaders"
!macroend

Function YwInstallMmdLoaderPack
  CreateDirectory "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd"
  Delete "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd\.removed"

  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd\loader.js" w
  FileWrite $0 "export {}; // First-party loader entry is provided by the app bundle.$\r$\n"
  FileClose $0

  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd\manifest.json" w
__YW_MMD_MANIFEST_FILEWRITE__
  FileClose $0
FunctionEnd

Function YwInstallGaussianSplatLoaderPack
  CreateDirectory "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat"
  Delete "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\.removed"

  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\loader.js" w
  FileWrite $0 "export {}; // First-party loader entry is provided by the app bundle.$\r$\n"
  FileClose $0

  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\manifest.json" w
__YW_GAUSSIAN_SPLAT_MANIFEST_FILEWRITE__
  FileClose $0
FunctionEnd

Function YwRemoveMmdLoaderPack
  RMDir /r "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd"
  CreateDirectory "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd"
  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\mmd\.removed" w
  FileWrite $0 "removed by installer$\r$\n"
  FileClose $0
FunctionEnd

Function YwRemoveGaussianSplatLoaderPack
  RMDir /r "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat"
  CreateDirectory "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat"
  FileOpen $0 "$APPDATA\com.yohawing.ywlook\optional-loaders\gaussian-splat\.removed" w
  FileWrite $0 "removed by installer$\r$\n"
  FileClose $0
FunctionEnd
