# Android emulator helper for testing Babel's Library (own AVD).
#   emu.ps1 create | start | install [apk] | launch | shot <name> | tap <x> <y> | swipe <x1> <y1> <x2> <y2>
#   emu.ps1 key <code> | js "<expr>" | log [n] | stop
param([Parameter(Mandatory = $true)][string]$Cmd, [string]$A1, [string]$A2, [string]$A3, [string]$A4)

$root = if ($env:BABEL_EMU_SDK) { $env:BABEL_EMU_SDK } else { "$env:USERPROFILE\AndroidEmuSDK" }
$env:ANDROID_SDK_ROOT = $root
$env:ANDROID_AVD_HOME = "$root\avd"
$adb = "$root\platform-tools\adb.exe"
$emulator = "$root\emulator\emulator.exe"
$avd = "Babel_S25"
$avdDir = "E:\BabelPhone\avd\$avd.avd"
$apk = "$PSScriptRoot\BabelsLibrary.apk"
$pkg = "com.personal.babelslibrary"
$shots = "$PSScriptRoot\build\emu_shots"

function Get-Serial {
    foreach ($line in (& $adb devices)) {
        if ($line -match '^(emulator-\d+)\s+device') {
            $s = $Matches[1]
            if (((& $adb -s $s emu avd name 2>$null) | Select-Object -First 1).Trim() -eq $avd) { return $s }
        }
    }
    return $null
}
$serial = $null
if ($Cmd -notin 'create', 'start') {
    for ($i = 0; $i -lt 10 -and -not ($serial = Get-Serial); $i++) { Start-Sleep 3 }
    if (-not $serial) { throw "emulator for AVD $avd is not running" }
}
function Adb { & $adb -s $serial @args }

switch ($Cmd) {
    'create' {
        New-Item -ItemType Directory -Force $avdDir | Out-Null
        Set-Content -Path "$env:ANDROID_AVD_HOME\$avd.ini" -Encoding ascii -Value @(
            "avd.ini.encoding=UTF-8", "path=$avdDir", "target=android-34")
        Set-Content -Path "$avdDir\config.ini" -Encoding ascii -Value @(
            "AvdId=$avd", "avd.ini.displayname=Babel S25 test", "avd.ini.encoding=UTF-8",
            "abi.type=x86_64", "hw.cpu.arch=x86_64", "hw.cpu.ncore=4",
            "image.sysdir.1=system-images\android-34\google_apis\x86_64\",
            "tag.id=google_apis", "tag.display=Google APIs", "PlayStore.enabled=false",
            "hw.lcd.width=1080", "hw.lcd.height=2340", "hw.lcd.density=420",
            "hw.ramSize=4096", "vm.heapSize=512", "disk.dataPartition.size=6G", "hw.sdCard=no",
            "hw.gpu.enabled=yes", "hw.gpu.mode=swiftshader_indirect", "hw.keyboard=yes", "hw.audioInput=yes",
            "hw.initialOrientation=portrait", "showDeviceFrame=no", "fastboot.forceColdBoot=yes")
        "AVD $avd ready at $avdDir"
    }
    'start' {
        if (-not (Get-Serial)) {
            Remove-Item "$avdDir\*.lock" -Recurse -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $emulator -ArgumentList "-avd", $avd, "-no-snapshot", "-no-boot-anim", "-no-window", "-gpu", $(if ($env:BABEL_EMU_GPU) { $env:BABEL_EMU_GPU } else { "host" }) -WindowStyle Hidden
        }
        for ($i = 0; $i -lt 120 -and -not ($serial = Get-Serial); $i++) { Start-Sleep 3 }
        if (-not $serial) { throw "emulator for AVD $avd did not come up" }
        for ($i = 0; $i -lt 120; $i++) {
            if ((Adb shell getprop sys.boot_completed 2>$null) -match '1') { break }
            Start-Sleep 3
        }
        "booted $serial"
    }
    'install' { Adb install -r $(if ($A1) { $A1 } else { $apk }) }
    'launch' {
        Adb logcat -c
        Adb shell am force-stop $pkg
        Adb shell am start -n "$pkg/.MainActivity" | Out-Null
        "launched on $serial"
    }
    'shot' {
        New-Item -ItemType Directory -Force $shots | Out-Null
        $out = "$shots\$A1.png"
        Adb shell screencap -p /sdcard/nt_shot.png
        Adb pull /sdcard/nt_shot.png $out | Out-Null
        $out
    }
    'tap' { Adb shell input tap $A1 $A2 }
    'swipe' { Adb shell input swipe $A1 $A2 $A3 $A4 300 }
    'key' { Adb shell input keyevent $A1 }
    'forward' {
        # WebView DevTools socket -> localhost:9334 (for js evaluation via CDP)
        $sock = (Adb shell "cat /proc/net/unix" | Select-String 'webview_devtools_remote_\d+' | Select-Object -First 1).Matches.Value
        if (-not $sock) { throw "no WebView devtools socket (is the app running?)" }
        Adb forward tcp:9334 "localabstract:$sock" | Out-Null
        "forwarded $sock -> tcp:9334"
    }
    'log' {
        $n = if ($A1) { $A1 } else { 60 }
        Adb logcat -d -s chromium:V AndroidRuntime:E System.err:W | Select-Object -Last $n
    }
    'pid' { Adb shell pidof $pkg }
    'stop' { Adb emu kill }
    default { "unknown command $Cmd" }
}

