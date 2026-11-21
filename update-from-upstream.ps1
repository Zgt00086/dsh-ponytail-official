param(
    [string]$Tag = '',
    [string]$Upstream = ''
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @Arguments 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }
    return [pscustomobject]@{
        Code   = $code
        Output = @($out | ForEach-Object { "$_" })
    }
}

$plugin = $PSScriptRoot

if ($Upstream -eq '') {
    $candidates = @(
        (Join-Path (Split-Path $plugin -Parent) 'ponytail-upstream'),
        'D:\ponytail-upstream'
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c '.git')) { $Upstream = $c; break }
    }
}

if ($Upstream -eq '' -or -not (Test-Path (Join-Path $Upstream '.git'))) {
    throw "上游仓库不存在。先 git clone https://github.com/DietrichGebert/ponytail.git D:\ponytail-upstream，或用 -Upstream <path> 指定"
}

$fetch = Invoke-Git @('-C', $Upstream, 'fetch', '--tags', '--force')
if ($fetch.Code -ne 0) {
    Write-Host 'fetch 失败（可能离线），继续用本地已有 tag'
}

if ($Tag -ne '') {
    $co = Invoke-Git @('-C', $Upstream, 'checkout', $Tag)
    if ($co.Code -ne 0) { throw "tag $Tag 不存在" }
    Write-Host "已检出指定 tag: $Tag"
}
else {
    $tags = Invoke-Git @('-C', $Upstream, 'tag', '--sort', '-creatordate')
    $latest = $tags.Output | Select-Object -First 1
    if (-not $latest) { throw '上游没有任何 tag' }
    $co = Invoke-Git @('-C', $Upstream, 'checkout', $latest)
    if ($co.Code -ne 0) { throw "无法检出 $latest" }
    Write-Host "已检出上游最新 tag: $latest"
}

$srcSkills = Join-Path $Upstream 'skills'
$dstSkills = Join-Path $plugin 'skills'
if (-not (Test-Path (Join-Path $srcSkills 'ponytail\SKILL.md'))) {
    throw "上游缺少 skills/ponytail/SKILL.md，检出内容异常"
}
if (Test-Path $dstSkills) { Remove-Item -Recurse -Force $dstSkills }
Copy-Item -Recurse -Force -Path $srcSkills -Destination $dstSkills
Remove-Item -Force (Join-Path $dstSkills 'plugin.json') -ErrorAction SilentlyContinue
Write-Host 'skills/ 已同步'

$srcAgents = Join-Path $Upstream 'AGENTS.md'
if (-not (Test-Path $srcAgents)) { throw '上游缺少 AGENTS.md' }
Copy-Item -Force -Path $srcAgents -Destination (Join-Path $plugin 'AGENTS.md')
Write-Host 'AGENTS.md 已同步'

$desc = Invoke-Git @('-C', $Upstream, 'describe', '--tags', '--exact-match')
$resolvedTag = ''
if ($desc.Code -eq 0) { $resolvedTag = ($desc.Output | Select-Object -First 1) }

if ($resolvedTag -match '^v?([0-9]+\.[0-9]+\.[0-9]+.*)$') {
    $ver = $Matches[1]
    $pkgPath = Join-Path $plugin 'package.json'
    $raw = [System.IO.File]::ReadAllText($pkgPath)
    $new = $raw -replace '"version"\s*:\s*"[^"]*"', ('"version": "' + $ver + '"')
    [System.IO.File]::WriteAllText($pkgPath, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "package.json version -> $ver"
}

Write-Host '同步完成。DSH 桌面端 patchReload=live 会自动热重载；未生效则重启 DSH。'
