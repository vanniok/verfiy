$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPidPathEncoded = & node --input-type=module -e "import {runtimePath} from './backend/resources.mjs'; console.log(Buffer.from(runtimePath('process','server.pid'),'utf8').toString('base64'));"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the configured private process record.' }
$taskPrivatePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskPidPathEncoded.Trim()))
if (-not (Test-Path -LiteralPath $taskPrivatePath)) { Write-Host 'No process record for this copy.'; exit 0 }
$taskPidText = (Get-Content -LiteralPath $taskPrivatePath -Raw).Trim()
if ($taskPidText -notmatch '^\d+$') { throw 'Invalid private process record.' }
$taskTargetPid = [int]$taskPidText
$taskTargetProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskTargetPid"
$taskExpectedScript = Join-Path $PSScriptRoot 'server.mjs'
if (-not $taskTargetProcess -or -not $taskTargetProcess.CommandLine -or -not $taskTargetProcess.CommandLine.Contains($taskExpectedScript)) { throw 'Process identity does not match this public copy. No process was stopped.' }
& (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $taskTargetPid /T /F
if ($LASTEXITCODE -ne 0) { throw 'Could not stop this instance tree. Its process record was preserved.' }
if ((Test-Path -LiteralPath $taskPrivatePath) -and (Get-Content -LiteralPath $taskPrivatePath -Raw).Trim() -eq $taskPidText) { Remove-Item -LiteralPath $taskPrivatePath }
Write-Host 'Stopped only the process belonging to this copy.'
