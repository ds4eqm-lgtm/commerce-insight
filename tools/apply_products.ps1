# 커머스 인사이트 · 상품목록 적용
# commerce05.html 에서 내려받은 '적용 파일'을 이 저장소에 넣는다. (토큰 없음, 깃허브에 직접 올리지 않음)
# - 가장 최근의 커머스인사이트_상품목록_*.txt  → products.txt
# - 가장 최근의 커머스인사이트_업체정보_*.json → stores.json (있을 때만)
# 바꾸기 전에 기존 파일은 backups 폴더에 복사해 두고, 아무것도 지우지 않는다.
# 끝나면 GitHub Desktop 에서 Push 하면 된다.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dirs = @((Join-Path $env:USERPROFILE 'Downloads\커머스인사이트'), (Join-Path $env:USERPROFILE 'Downloads')) | Where-Object { Test-Path $_ }
$utf8 = New-Object System.Text.UTF8Encoding $false

function Latest($pattern) {
  $dirs | ForEach-Object { Get-ChildItem -Path $_ -Filter $pattern -File -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
function LinkNos($text) {
  @([regex]::Matches($text, '(?m)^\s*https?://\S+/products/(\d+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
}

Write-Host ''
Write-Host '=== 커머스 인사이트 · 상품목록 적용 ===' -ForegroundColor Cyan
$list = Latest '커머스인사이트_상품목록_*.txt'
if (-not $list) {
  Write-Host '내려받은 상품목록 파일(커머스인사이트_상품목록_*.txt)을 다운로드 폴더에서 찾지 못했습니다.' -ForegroundColor Yellow
  Write-Host '화면에서 [적용 파일 내려받기]를 먼저 눌러 주세요.'
  return
}

$newText = [IO.File]::ReadAllText($list.FullName, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
# 내려받을 때 붙은 안내 줄(# 커머스 인사이트 ...)은 빼고 넣음
$newText = ($newText -split "`r?`n" | Where-Object { $_ -notmatch '^# 커머스 인사이트' }) -join "`r`n"
$curPath = Join-Path $repo 'products.txt'
$curText = if (Test-Path $curPath) { [IO.File]::ReadAllText($curPath, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF) } else { '' }

$newNos = LinkNos $newText
$curNos = LinkNos $curText
if ($newNos.Count -eq 0) {
  Write-Host "파일에 상품 링크가 하나도 없어 적용하지 않았습니다: $($list.Name)" -ForegroundColor Red
  return
}
$added = @($newNos | Where-Object { $curNos -notcontains $_ })
$removed = @($curNos | Where-Object { $newNos -notcontains $_ })

Write-Host "적용할 파일 : $($list.Name)  ($($list.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))"
Write-Host "지금 목록   : 상품 $($curNos.Count)개"
Write-Host "새 목록     : 상품 $($newNos.Count)개  (추가 $($added.Count) · 목록에서 빠짐 $($removed.Count))"
if ($removed.Count) { Write-Host '목록에서 빠지는 상품은 수집만 멈추고, 지금까지의 판매 기록은 그대로 남습니다.' -ForegroundColor DarkGray }

$stores = Latest '커머스인사이트_업체정보_*.json'
# 상품목록과 함께 내려받은 업체정보만 씀: 상품목록 파일보다 10분 넘게 오래된 업체정보는 옛 파일이라 건너뜀 (옛 단가로 되돌아가는 것 방지)
if ($stores -and $stores.LastWriteTime -lt $list.LastWriteTime.AddMinutes(-10)) {
  Write-Host "업체정보    : $($stores.Name) 은(는) 상품목록보다 오래된 파일이라 건너뜁니다 (stores.json 그대로)" -ForegroundColor DarkGray
  $stores = $null
}
if ($stores) {
  try { $null = [IO.File]::ReadAllText($stores.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json }
  catch { Write-Host "업체정보 파일이 올바른 형식이 아니라 건너뜁니다: $($stores.Name)" -ForegroundColor Yellow; $stores = $null }
}
if ($stores) { Write-Host "업체정보    : $($stores.Name)" }

if ($newText.Trim() -eq $curText.Trim() -and -not $stores) {
  Write-Host '지금 목록과 같아서 바꿀 것이 없습니다.' -ForegroundColor Green
  return
}

$ans = Read-Host '적용할까요? (Y/N)'
if ($ans -notmatch '^[Yy]') { Write-Host '취소했습니다. 아무것도 바꾸지 않았습니다.'; return }

$bk = Join-Path $repo 'backups'
New-Item -ItemType Directory -Force $bk | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $curPath) { Copy-Item $curPath (Join-Path $bk "products_$stamp.txt") }
[IO.File]::WriteAllText($curPath, $newText.TrimEnd() + "`r`n", $utf8)

if ($stores) {
  $sPath = Join-Path $repo 'stores.json'
  if (Test-Path $sPath) { Copy-Item $sPath (Join-Path $bk "stores_$stamp.json") }
  Copy-Item $stores.FullName $sPath -Force
}

Add-Content -Path (Join-Path $bk 'apply_log.txt') -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $($list.Name)  상품 $($curNos.Count)→$($newNos.Count)$(if ($stores) { '  + ' + $stores.Name })"

Write-Host ''
Write-Host "적용했습니다. 이전 목록은 backups\products_$stamp.txt 에 보관했습니다." -ForegroundColor Green
Write-Host '이제 GitHub Desktop 에서 변경 내용을 Commit 한 뒤 [Push origin] 을 눌러 주세요.' -ForegroundColor Green
Write-Host '다음 정각 자동 수집부터 새 목록이 쓰입니다.'
