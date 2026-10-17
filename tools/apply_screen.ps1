# 커머스 인사이트 · 화면 적용
# 새 commerce05.html 을 저장소 폴더에 넣는다. (토큰 없음, 깃허브에 직접 올리지 않음)
# - 찾는 곳: 이 저장소 폴더의 _new 폴더, 다운로드\커머스인사이트, 다운로드
# - 바꾸기 전에 지금 화면은 backups 폴더에 복사해 두고, 수집기·데이터·상품목록은 건드리지 않는다.
# 끝나면 GitHub Desktop 을 열어 준다 → Commit to main → Push origin

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dirs = @((Join-Path $repo '_new'), (Join-Path $env:USERPROFILE 'Downloads\커머스인사이트'), (Join-Path $env:USERPROFILE 'Downloads')) | Where-Object { Test-Path $_ }

function VersionOf($path) {
  $t = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  $m = [regex]::Match($t, "const APP_VERSION = '([^']+)'")
  if ($m.Success -and $t.Contains('커머스 인사이트')) { return $m.Groups[1].Value }
  return $null
}

Write-Host ''
Write-Host '=== 커머스 인사이트 · 화면 적용 ===' -ForegroundColor Cyan
$new = $dirs | ForEach-Object { Get-ChildItem -Path $_ -Filter 'commerce05*.html' -File -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $new) {
  Write-Host '새 화면 파일(commerce05.html)을 다운로드 폴더에서 찾지 못했습니다.' -ForegroundColor Yellow
  return
}
$newVer = VersionOf $new.FullName
if (-not $newVer) { Write-Host "커머스 인사이트 화면 파일이 아니라 적용하지 않았습니다: $($new.FullName)" -ForegroundColor Red; return }

$cur = Join-Path $repo 'commerce05.html'
$curVer = if (Test-Path $cur) { VersionOf $cur } else { '없음' }
Write-Host "새 화면  : $newVer  ($($new.FullName), $($new.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))"
Write-Host "지금 화면: $curVer"
if ((Test-Path $cur) -and ((Get-FileHash $cur).Hash -eq (Get-FileHash $new.FullName).Hash)) {
  Write-Host '이미 같은 화면이 적용되어 있습니다. GitHub Desktop 에서 Push 만 했는지 확인하세요.' -ForegroundColor Green
} else {
  $ans = Read-Host '적용할까요? (Y/N)'
  if ($ans -notmatch '^[Yy]') { Write-Host '취소했습니다. 아무것도 바꾸지 않았습니다.'; return }
  $bk = Join-Path $repo 'backups'
  New-Item -ItemType Directory -Force $bk | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if (Test-Path $cur) { Copy-Item $cur (Join-Path $bk "commerce05_$($curVer)_$stamp.html") }
  Copy-Item $new.FullName $cur -Force
  Add-Content -Path (Join-Path $bk 'apply_log.txt') -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  화면 $curVer → $newVer  ($($new.Name))"
  Write-Host "적용했습니다. 이전 화면은 backups 폴더에 보관했습니다." -ForegroundColor Green
}

Write-Host ''
Write-Host '이제 GitHub Desktop 이 열리면:' -ForegroundColor Cyan
Write-Host "  1) 왼쪽 아래 Summary 칸에  화면 $newVer  입력 → Commit to main"
Write-Host '  2) 위쪽 Push origin 누르기'
Write-Host '  3) 1~2분 뒤 대시보드에서 Ctrl+F5 → 오른쪽 위 버전 확인'
try { Start-Process ("x-github-client://openLocalRepo/" + [uri]::EscapeDataString($repo)) } catch { Write-Host 'GitHub Desktop 을 직접 열어 주세요.' -ForegroundColor Yellow }
