# Builds BabelsLibrary.apk without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
#   powershell -File build_apk.ps1
# Where things are (set these to override the defaults):
#   BABEL_DESKTOP        the computer app's static folder (themes, fonts and reader libraries are shared with it)
#   BABEL_PYTHON         python.exe
#   BABEL_ANDROID_TOOLS  a folder with SDK\build-tools\34.0.0, SDK\platforms\android-34 and OpenJDK (Unity's AndroidPlayer has them)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$desk = if ($env:BABEL_DESKTOP) { $env:BABEL_DESKTOP } else { 'F:\Inkwell\app\static' }
$py = if ($env:BABEL_PYTHON) { $env:BABEL_PYTHON } elseif (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe") { "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" } else { 'python' }
$ap = if ($env:BABEL_ANDROID_TOOLS) { $env:BABEL_ANDROID_TOOLS } else { 'E:\Unity\2022.3.62f2\Editor\Data\PlaybackEngines\AndroidPlayer' }
$bt = "$ap\SDK\build-tools\34.0.0"
$jar = "$ap\SDK\platforms\android-34\android.jar"
$jdk = "$ap\OpenJDK\bin"
$out = "$root\build\apk"
$env:JAVA_HOME = Split-Path $jdk
$env:PATH = "$jdk;$env:PATH"
$apk = "$root\BabelsLibrary.apk"

function Run($exe) {
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path $exe -Leaf) failed ($LASTEXITCODE)" }
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\res", "$out\gen", "$out\classes", "$out\dex", "$out\assets" | Out-Null

# web app -> assets/web, plus what it shares with the computer app
$web = "$out\assets\web"
Copy-Item -Recurse "$root\web" $web
Copy-Item "$desk\css\themes.css" "$web\css\themes.css"
Copy-Item "$desk\js\themes.js" "$web\js\themes.js"
# the browser's YouTube ad remover is the computer's own (adblock.YOUTUBE_JS)
Run $py -c "import sys; sys.path.insert(0, r'$desk\..'); import adblock; open(r'$web\yt_adblock.js', 'w', encoding='utf-8').write(adblock.YOUTUBE_JS)"
New-Item -ItemType Directory -Force "$web\vendor\fonts" | Out-Null
foreach ($f in 'pdf.min.js', 'pdf.worker.min.js', 'epub.min.js', 'jszip.min.js') { Copy-Item "$desk\vendor\$f" "$web\vendor\$f" }
Copy-Item -Recurse "$desk\vendor\libarchive" "$web\vendor\libarchive"   # CBR, CB7 and CBT comics
foreach ($f in Get-ChildItem "$desk\vendor\fonts" -Filter *.woff2 | Where-Object { $_.Name -match '^(fredoka|nunito|ibm-plex-mono|anton|archivo-narrow|permanent-marker|im-fell-english-latin|chakra-petch-latin-700|cormorant-garamond-latin-600|libre-baskerville-latin-400)' }) { Copy-Item $f.FullName "$web\vendor\fonts\" }

# resources: hand-written values + launcher icons made from the desktop icon
Copy-Item -Recurse "$root\android\res\*" "$out\res"
Run $py "$root\make_icons.py" "$desk\icon.png" "$out\res"

Run "$bt\aapt2.exe" compile --dir "$out\res" -o "$out\res.zip"
Run "$bt\aapt2.exe" link -o "$out\base.apk" -I $jar --manifest "$root\android\AndroidManifest.xml" `
    --java "$out\gen" -A "$out\assets" --min-sdk-version 26 --target-sdk-version 34 -0 woff2 "$out\res.zip"

$src = @(Get-ChildItem -Recurse "$root\android\src", "$out\gen" -Filter *.java | ForEach-Object FullName)
Run "$jdk\javac.exe" -encoding UTF-8 --release 11 -classpath $jar -d "$out\classes" '-Xlint:-options' @src
$classes = @(Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" --release --min-api 26 --lib $jar --output "$out\dex" @classes

Run $py "$root\tools\pack_apk.py" "$out\base.apk" "$out\dex\classes.dex" "$out\unaligned.apk"
Run "$bt\zipalign.exe" -p -f 4 "$out\unaligned.apk" "$out\aligned.apk"

# personal signing key, created once and kept next to the project (updates must be signed with the same key)
$ks = "$root\babel-personal.keystore"
$pwFile = "$root\keystore-password.txt"
if (-not (Test-Path $ks)) {
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
    Set-Content -Path $pwFile -Value $pw -Encoding ascii -NoNewline
    Run "$jdk\keytool.exe" -genkeypair -keystore $ks -alias babel -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $pw -keypass $pw -dname "CN=Babel's Library (personal)"
}
$pw = (Get-Content $pwFile -Raw).Trim()
Run "$bt\apksigner.bat" sign --ks $ks --ks-key-alias babel --ks-pass "pass:$pw" --key-pass "pass:$pw" --out $apk "$out\aligned.apk"
Run "$bt\apksigner.bat" verify $apk
"{0} ({1:N1} MB)" -f $apk, ((Get-Item $apk).Length / 1MB)
