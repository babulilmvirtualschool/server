param([string]$WebPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\web'))
$ErrorActionPreference = 'Stop'
$taskServerRoot = Split-Path $PSScriptRoot -Parent
$taskWebRoot = (Resolve-Path -LiteralPath $WebPath).Path
$taskNode = (Get-Command node).Source
$taskLogDirectory = Join-Path $taskServerRoot '.local'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
$taskPidFile = Join-Path $taskLogDirectory 'processes.json'
$taskRecords = @()
if (Test-Path -LiteralPath $taskPidFile) { $taskRecords = @(Get-Content -LiteralPath $taskPidFile -Raw | ConvertFrom-Json) }
function Test-LocalPort([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}
function Wait-LocalPort([int]$Port, [string]$Name) {
  $taskDeadline = (Get-Date).AddSeconds(45)
  while (-not (Test-LocalPort $Port)) {
    if ((Get-Date) -gt $taskDeadline) { throw "$Name did not start. Check the logs in $taskLogDirectory." }
    Start-Sleep -Milliseconds 250
  }
}
function Start-LocalProcess([string]$Name, [string]$Directory, [string]$Arguments) {
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDirectory "$Name.log") -RedirectStandardError (Join-Path $taskLogDirectory "$Name.error.log") -PassThru
  $taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskProcess.Id)"
  $script:taskRecords += [PSCustomObject]@{ Name=$Name; Id=$taskProcess.Id; CreationTicks=$taskInfo.CreationDate.ToUniversalTime().Ticks.ToString(); CommandLine=$taskInfo.CommandLine }
  ConvertTo-Json -InputObject @($script:taskRecords) | Set-Content -LiteralPath $taskPidFile -Encoding utf8
  Write-Host "Started $Name (PID $($taskProcess.Id))."
}
Push-Location -LiteralPath $taskServerRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $taskWebRoot 'node_modules\next'))) { throw 'Run npm ci in the frontend folder first.' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskServerRoot 'node_modules\embedded-postgres'))) { throw 'Run npm ci in the backend folder first.' }
  & $taskNode scripts/setup-local.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local environment setup failed.' }
  & $taskNode -e "process.loadEnvFile(); const d=new URL(process.env.DATABASE_URL); const s=new URL(process.env.R2_ENDPOINT); if(process.env.NODE_ENV!=='development'||!['localhost','127.0.0.1'].includes(d.hostname)||!['localhost','127.0.0.1'].includes(s.hostname)||Number(d.port)!==5432||Number(s.port)!==4569||Number(process.env.PORT)!==4000) throw Error('This launcher requires local development settings: PostgreSQL 5432, uploads 4569, backend 4000.');"
  if ($LASTEXITCODE -ne 0) { throw 'Local configuration check failed. No migrations were applied.' }
  $taskDatabaseRunning = Test-LocalPort 5432
  $taskStorageRunning = Test-LocalPort 4569
  if (-not $taskDatabaseRunning -and -not $taskStorageRunning) {
    Start-LocalProcess 'services' $taskServerRoot 'scripts/local-services.mjs'
    Wait-LocalPort 5432 'PostgreSQL'
    Wait-LocalPort 4569 'Local storage'
  } elseif (-not $taskDatabaseRunning -or -not $taskStorageRunning) {
    throw 'Only one local service is running. Stop the existing local services before restarting.'
  }
  & $taskNode node_modules/prisma/build/index.js generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed.' }
  & $taskNode node_modules/prisma/build/index.js migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
  & $taskNode --env-file=.env node_modules/ts-node/dist/bin.js prisma/seed.ts
  if ($LASTEXITCODE -ne 0) { throw 'Database seeding failed.' }
  if (-not (Test-LocalPort 4000)) { Start-LocalProcess 'api' $taskServerRoot 'node_modules/@nestjs/cli/bin/nest.js start --watch' }
  Wait-LocalPort 4000 'Backend'
  if (-not (Test-LocalPort 3000)) { Start-LocalProcess 'web' $taskWebRoot 'node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000' }
  Wait-LocalPort 3000 'Frontend'
  Write-Host 'Website: http://localhost:3000'
  Write-Host 'Login:   http://localhost:3000/lms/login'
  Write-Host 'API docs: http://localhost:4000/api/docs'
  Write-Host 'Separate repositories are preserved. Logs and local data are in server/.local/.'
} finally { Pop-Location }
