# VeritAI 모바일 앱 설치 (처음 한 번, 또는 설치가 꼬였을 때). 실행: npm run setup
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/3] 이전 설치 흔적 정리..." -ForegroundColor Cyan
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }

Write-Host "[2/3] package.json 기준으로 설치 (Expo SDK 57 고정)..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 실패" }

Write-Host "[3/3] SDK 57 과 버전이 맞는지 확인..." -ForegroundColor Cyan
npx expo install --check
if ($LASTEXITCODE -ne 0) { throw "버전 확인 실패 (위 메시지를 확인하세요)" }

Write-Host ""
Write-Host "설치 완료! 폰을 USB로 연결한 뒤 아래 명령으로 앱을 설치/실행하세요." -ForegroundColor Green
Write-Host "  npm run android"
