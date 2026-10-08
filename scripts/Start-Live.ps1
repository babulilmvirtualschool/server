# Runs the backend (http://localhost:4000) and frontend (http://localhost:3000) on this machine
# against the database/storage configured in server/.env (e.g. the hosted production database).
# SAFE BY DESIGN: does NOT run migrations or seed. Schema changes reach the live DB only via the deploy workflow.
# Stop with .\scripts\Stop-Local.ps1 (same process bookkeeping).
param([string]$WebPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\web'))
$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path $PSScriptRoot -Parent
$webRoot = (Resolve-Path -LiteralPath $WebPath).Path
$node = (Get-Command node).Source
$logDir = Join-Path $serverRoot '.local'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$pidFile = Join-Path $logDir 'processes.json'
$records = @()
if (Test-Path -LiteralPath $pidFile) { $records = @((Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.Id }) }

function Test-Port([int]$Port) { return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Wait-Port([int]$Port, [string]$Name, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while (-not (Test-Port $Port)) {
    if ((Get-Date) -gt $deadline) { throw "$Name did not start. Check $logDir\live-$($Name.ToLower()).log and .error.log" }
    Start-Sleep -Milliseconds 500
  }
}
function Start-Proc([string]$Name, [string]$Dir, [string]$ArgList) {
  $p = Start-Process -FilePath $node -ArgumentList $ArgList -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "$Name.log") -RedirectStandardError (Join-Path $logDir "$Name.error.log") -PassThru
  $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)"
  $script:records += [PSCustomObject]@{ Name=$Name; Id=$p.Id; CreationTicks=$info.CreationDate.ToUniversalTime().Ticks.ToString(); CommandLine=$info.CommandLine }
  ConvertTo-Json -InputObject @($script:records) | Set-Content -LiteralPath $pidFile -Encoding utf8
  Write-Host "Started $Name (PID $($p.Id))."
}

Push-Location -LiteralPath $serverRoot
try {
  if (-not (Test-Path -LiteralPath '.env')) { throw 'server/.env is missing.' }
  if (-not (Test-Path -LiteralPath 'node_modules\@nestjs\cli')) { throw 'Run npm ci in server/ first.' }
  if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'node_modules\next'))) { throw 'Run npm ci in web/ first.' }
  & $node -e "process.loadEnvFile(); const h=new URL(process.env.DATABASE_URL).hostname; console.log('Database host: '+h); if(Number(process.env.PORT||4000)!==4000) throw Error('Expected PORT=4000');"
  if ($LASTEXITCODE -ne 0) { throw 'Environment check failed.' }

  Write-Host 'Generating Prisma client (no migrations, no seed)...'
  & $node node_modules/prisma/build/index.js generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma generate failed.' }

  if (Test-Port 4000) { Write-Host 'Port 4000 already in use - assuming the API is already running.' }
  else { Start-Proc 'live-api' $serverRoot 'node_modules/@nestjs/cli/bin/nest.js start --watch'; Wait-Port 4000 'API' }

  if (Test-Port 3000) { Write-Host 'Port 3000 already in use - assuming the website is already running.' }
  else { Start-Proc 'live-web' $webRoot 'node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000'; Wait-Port 3000 'Web' }

  Write-Host ''
  Write-Host 'Website:  http://localhost:3000'
  Write-Host 'Login:    http://localhost:3000/lms/login'
  Write-Host 'API docs: http://localhost:4000/api/docs'
  Write-Host 'Connected to the LIVE database - changes you make are real.'
  Start-Process 'http://localhost:3000/lms/login'
} finally { Pop-Location }
