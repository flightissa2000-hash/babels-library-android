# Opens item <id> in the phone app's reader and takes a screenshot <name>.
param([int]$Id, [string]$Name, [int]$Wait = 6)
$r = $PSScriptRoot
Set-Content -Encoding utf8 "$r\build\rd.js" "(async()=>{Reader.close&&Reader.open&&Reader.close();await Reader.start(S.items[$Id]);await new Promise(r=>setTimeout(r,$($Wait*1000)));return {pos:(document.querySelector('#rPos')||{}).textContent,html:document.querySelector('#rStage').innerHTML.slice(0,160),loc:S.items[$Id].last_location}})()"
$py = if ($env:BABEL_PYTHON) { $env:BABEL_PYTHON } else { "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" }
& $py "$r\cdp.py" "@$r\build\rd.js"
powershell -NoProfile -ExecutionPolicy Bypass -File "$r\emu.ps1" shot $Name | Out-Null
