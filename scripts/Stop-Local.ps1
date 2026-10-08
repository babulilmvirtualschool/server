$ErrorActionPreference = 'Stop'
$taskServerRoot = Split-Path $PSScriptRoot -Parent
$taskPidFile = Join-Path $taskServerRoot '.local\processes.json'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No saved local process IDs.'; return }
$taskRecords = @(Get-Content -LiteralPath $taskPidFile -Raw | ConvertFrom-Json)
foreach ($taskRecord in ($taskRecords | Sort-Object { if ($_.Name -eq 'services') { 1 } else { 0 } })) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRecord.Id)" -ErrorAction SilentlyContinue
  if (-not $taskProcess) { continue }
  if ($taskProcess.CreationDate.ToUniversalTime().Ticks.ToString() -ne $taskRecord.CreationTicks -or $taskProcess.CommandLine -ne $taskRecord.CommandLine) { Write-Warning "Skipping reused PID $($taskRecord.Id)."; continue }
  if ($taskRecord.Name -eq 'services') {
    $taskPgCtl = Join-Path $taskServerRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
    & $taskPgCtl -D (Join-Path $taskServerRoot '.local\postgres') -m fast -w stop
  }
  & taskkill /PID $taskRecord.Id /T /F
}
Write-Host 'Local servers stopped. Database and uploaded files are preserved.'
