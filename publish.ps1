# Copies RoundStats match history into this site's data folder, then commits and pushes it.
# The RoundStats mod runs this after every point and game (set Publishing.Script in its config).
param(
    [string]$HistoryDir = "$env:APPDATA\r2modmanPlus-local\ROUNDS\profiles\Foobar\BepInEx\config\RoundStats\history",
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$data = Join-Path $site 'data'
$matchesDir = Join-Path $data 'matches'
$log = Join-Path $site 'publish.log'

function Log($message) {
    Add-Content -Path $log -Value "$(Get-Date -Format s)  $message" -Encoding utf8
}

# Only one publish at a time, even if launched twice.
$mutex = New-Object System.Threading.Mutex($false, 'Global\RoundStatsPublish')
if (-not $mutex.WaitOne([TimeSpan]::FromMinutes(2))) { Log 'Another publish is still running; skipped.'; exit 0 }

try {
    New-Item -ItemType Directory -Force $matchesDir | Out-Null

    $finished = @(Get-ChildItem $HistoryDir -Filter '*.json' -ErrorAction SilentlyContinue | Where-Object Name -ne 'live.json')
    foreach ($f in $finished) {
        $dest = Join-Path $matchesDir $f.Name
        if (-not (Test-Path $dest) -or (Get-Item $dest).Length -ne $f.Length) { Copy-Item $f.FullName $dest -Force }
    }

    $liveSource = Join-Path $HistoryDir 'live.json'
    $liveDest = Join-Path $data 'live.json'
    $hasLive = Test-Path $liveSource
    if ($hasLive) { Copy-Item $liveSource $liveDest -Force } elseif (Test-Path $liveDest) { Remove-Item $liveDest }

    $names = @(Get-ChildItem $matchesDir -Filter '*.json' | Sort-Object Name -Descending | ForEach-Object Name)
    $index = [ordered]@{ updated = (Get-Date).ToString('o'); live = $hasLive; matches = $names }
    $index | ConvertTo-Json | Set-Content -Path (Join-Path $data 'index.json') -Encoding utf8

    if ($NoPush) { Log "Updated data ($($names.Count) matches, live=$hasLive); push skipped."; exit 0 }

    git -C $site add data 2>&1 | Out-Null
    git -C $site diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Log 'No changes.'; exit 0 }

    $message = if ($hasLive) { 'Live game update' } else { "Match history: $($names.Count) games" }
    $out = git -C $site commit -m $message 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Log "Commit failed: $out"; exit 1 }
    $out = git -C $site push 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Log "Push failed: $out"; exit 1 }
    Log "Published: $message"
}
catch {
    Log "Error: $_"
    exit 1
}
finally {
    $mutex.ReleaseMutex()
}
