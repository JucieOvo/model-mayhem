<#
 * Model Mayhem 一键启动脚本。
 *
 * 作者：JucieOvo
 *
 * 负责检查 Node.js 与包管理器、创建本地配置、安装锁定依赖、构建前端并启动服务。
 * 已存在的 .env 和玩家数据不会被覆盖；首次运行时才根据 .env.example 创建配置。
 #>

param(
  [switch]$CheckOnly,
  [switch]$NoStart,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$MinimumNodeVersion = [version]"22.22.0"
$MinimumPnpmVersion = [version]"10.34.5"
$PnpmPackage = "pnpm@10.34.5"

Set-Location $Root

function Write-Step {
  param([string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Import-DotEnv {
  param([string]$Path)

  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }
    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) {
      continue
    }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($null -eq [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Set-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Value
  )

  $content = [IO.File]::ReadAllText($Path)
  $pattern = "(?m)^" + [regex]::Escape($Name) + "=.*$"
  $replacement = $Name + "=" + $Value
  if ([regex]::IsMatch($content, $pattern)) {
    $replacement = $replacement.Replace('$', '$$')
    $content = [regex]::Replace($content, $pattern, $replacement)
  } else {
    $content = $content.TrimEnd() + [Environment]::NewLine + $replacement + [Environment]::NewLine
  }
  [IO.File]::WriteAllText($Path, $content, [Text.UTF8Encoding]::new($false))
}

function Resolve-Pnpm {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpm) {
    $pnpmVersion = (& $pnpm.Source --version 2>$null | Select-Object -First 1).Trim()
    $parsedPnpmVersion = $null
    if (
      [version]::TryParse($pnpmVersion, [ref]$parsedPnpmVersion) -and
      $parsedPnpmVersion -ge $MinimumPnpmVersion
    ) {
      return [pscustomobject]@{
        Executable = $pnpm.Source
        Prefix = @()
      }
    }
    Write-Host "检测到旧版 pnpm，将使用 $PnpmPackage。" -ForegroundColor Yellow
  }

  $corepack = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepack) {
    & $corepack.Source pnpm --version *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{
        Executable = $corepack.Source
        Prefix = @("pnpm")
      }
    }
  }

  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if (-not $npx) {
    $npx = Get-Command npx -ErrorAction SilentlyContinue
  }
  if ($npx) {
    return [pscustomobject]@{
      Executable = $npx.Source
      Prefix = @("--yes", $PnpmPackage)
    }
  }

  throw "未找到 pnpm、Corepack 或 npx。请安装 Node.js 22.22.0 或更高版本后重试。"
}

function Invoke-Pnpm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PnpmArguments
  )

  $allArguments = @($script:PnpmPrefix) + @($PnpmArguments)
  & $script:PnpmExecutable @allArguments
  $commandSucceeded = $?
  $commandExitCode = $LASTEXITCODE
  if (-not $commandSucceeded -or ($null -ne $commandExitCode -and $commandExitCode -ne 0)) {
    throw "pnpm 命令执行失败：pnpm $($PnpmArguments -join ' ')"
  }
}

function Test-DependenciesReady {
  $statePath = Join-Path $Root "node_modules/.modules.yaml"
  if (-not (Test-Path -LiteralPath $statePath)) {
    return $false
  }
  $state = Get-Item -LiteralPath $statePath
  return @(
    Get-Item -LiteralPath (Join-Path $Root "package.json")
    Get-Item -LiteralPath (Join-Path $Root "pnpm-lock.yaml")
  ) | Where-Object { $_.LastWriteTimeUtc -gt $state.LastWriteTimeUtc } | Select-Object -First 1
}

function Test-ServerReady {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-BrowserWhenReady {
  param([string]$Url)

  return Start-Job -ScriptBlock {
    param($Target)

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$Target/api/health" -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
          Start-Process $Target
          return
        }
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
  } -ArgumentList $Url
}

Write-Step "检查运行环境"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "未找到 Node.js。请安装 Node.js 22.22.0 或更高版本：https://nodejs.org/"
}
$nodeVersion = [version]((& $node.Source -p "process.versions.node").Trim())
if ($nodeVersion -lt $MinimumNodeVersion) {
  throw "当前 Node.js 版本为 $nodeVersion，需要 22.22.0 或更高版本。"
}

$resolvedPnpm = Resolve-Pnpm
$script:PnpmExecutable = $resolvedPnpm.Executable
$script:PnpmPrefix = @($resolvedPnpm.Prefix)
Write-Host "Node.js $nodeVersion 已就绪。"
Write-Host "包管理器命令已就绪。"

if ($CheckOnly) {
  Write-Host "启动环境检查通过。" -ForegroundColor Green
  return
}

Write-Step "检查本地配置"
$environmentPath = Join-Path $Root ".env"
if (-not (Test-Path -LiteralPath $environmentPath)) {
  Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination $environmentPath
  Write-Host "已根据 .env.example 创建 .env。"
}
Import-DotEnv $environmentPath

if ($env:MODELMAYHEM_UPDATE_REPOSITORY -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "配置了更新仓库，但系统中未找到 Git。请安装 Git，或在 .env 中清空更新仓库。"
}

if (-not $env:DEEPSEEK_API_KEY) {
  Write-Host "未设置 DEEPSEEK_API_KEY，Agent 回合将暂停。" -ForegroundColor Yellow
  if ([Environment]::UserInteractive) {
    $apiKey = Read-Host "请输入 DEEPSEEK_API_KEY，直接回车跳过"
    if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
      $env:DEEPSEEK_API_KEY = $apiKey.Trim()
      Set-DotEnvValue -Path $environmentPath -Name "DEEPSEEK_API_KEY" -Value $env:DEEPSEEK_API_KEY
      Write-Host "DEEPSEEK_API_KEY 已写入本地 .env，并被 Git 忽略。"
    }
  }
}

Write-Step "检查项目依赖"
if (-not (Test-DependenciesReady)) {
  Write-Host "首次运行或依赖已变化，正在安装锁定版本依赖。"
  Invoke-Pnpm install --frozen-lockfile
} else {
  Write-Host "项目依赖已是最新。"
}

Write-Step "构建前端"
Invoke-Pnpm --filter @modelmayhem/reference-web build

$serverUrl = $env:MODELMAYHEM_SERVER_URL
if (-not $serverUrl) {
  $serverUrl = "http://127.0.0.1:3210"
}
$serverUrl = $serverUrl.TrimEnd("/")

if (Test-ServerReady $serverUrl) {
  Write-Host "检测到服务已经在运行，正在打开浏览器。" -ForegroundColor Green
  Start-Process $serverUrl
  return
}

if ($NoStart) {
  Write-Host "启动准备完成，已按要求跳过启动服务。" -ForegroundColor Green
  return
}

Write-Step "启动 Model Mayhem"
if ($NoBrowser) {
  Write-Host "服务地址：$serverUrl"
  $browserJob = $null
} else {
  Write-Host "浏览器将在服务就绪后自动打开：$serverUrl"
  $browserJob = Start-BrowserWhenReady $serverUrl
}
try {
  Invoke-Pnpm --filter @modelmayhem/server start
} finally {
  if ($browserJob) {
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  }
}
