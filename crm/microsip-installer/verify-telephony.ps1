# Post-install check for DaraClean telephony - run on a manager PC AFTER DaraCleanTelephonySetup.exe.
# Confirms the SIP account + call recording landed in microsip.ini. It does NOT print the password.
# Note: SIP "registered" status is visual only - check MicroSIP shows the line GREEN.
$ErrorActionPreference = 'Stop'
$ini = Join-Path $env:APPDATA 'MicroSIP\microsip.ini'
if (-not (Test-Path $ini)) {
  Write-Host "FAIL: microsip.ini not found ($ini) - did the installer run for a manager?" -ForegroundColor Red
  exit 1
}
$kv = @{}
foreach ($l in Get-Content -LiteralPath $ini -Encoding Unicode) {
  if ($l -match '^\s*([^=\[;]+)=(.*)$') { $kv[$matches[1].Trim().ToLower()] = $matches[2].Trim() }
}
function Show($label, $key) { Write-Host ("  {0,-15}: {1}" -f $label, $kv[$key]) }

Write-Host "=== SIP account (confirm it matches the intended manager) ==="
Show 'username' 'username'; Show 'authID' 'authid'; Show 'server' 'server'; Show 'domain' 'domain'
Write-Host ("  {0,-15}: {1}" -f 'password set', [bool]$kv['password'])

Write-Host "=== Call recording ==="
Show 'autoRecording' 'autorecording'; Show 'format' 'recordingformat'; Show 'recordingPath' 'recordingpath'
$recOn = ($kv['autorecording'] -eq '1')
$fmtOk = ($kv['recordingformat'] -eq 'mp3')
$path = $kv['recordingpath']
$folderOk = $path -and (Test-Path $path)
Write-Host ("  {0,-15}: {1}" -f 'folder exists', $folderOk)

if ($folderOk) {
  $mp3 = @(Get-ChildItem -LiteralPath $path -Filter *.mp3 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)
  Write-Host ("=== recent recordings ($($mp3.Count)) ===")
  $mp3 | ForEach-Object { Write-Host ("  " + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + "  " + $_.Name) }
}

Write-Host ""
if ($recOn -and $fmtOk -and $folderOk) {
  Write-Host "VERDICT: config OK - recording is ready." -ForegroundColor Green
  Write-Host "Next: confirm MicroSIP shows the line GREEN (registered), then make a test call and re-run me to see the new .mp3."
} else {
  Write-Host "VERDICT: recording config incomplete - see fields above." -ForegroundColor Yellow
}
