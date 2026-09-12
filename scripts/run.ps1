$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js。需要 Node.js 22.22.0 或更高版本。"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "未找到 pnpm。需要 pnpm 10.34.5 或更高版本。"
}

if ($env:MODELMAYHEM_UPDATE_REPOSITORY -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "配置了更新仓库，但系统中未找到 git。"
}

if (-not $env:DEEPSEEK_API_KEY) {
  Write-Host "未设置 DEEPSEEK_API_KEY。服务会启动，但 Agent 回合将明确暂停。" -ForegroundColor Yellow
}

pnpm --filter @modelmayhem/reference-web build
pnpm --filter @modelmayhem/server start
