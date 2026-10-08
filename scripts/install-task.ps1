# Registers a Windows scheduled task that prints the paper once a day, even when the web server isn't running.
# Usage (from the project folder):   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 [-Time 06:00]
# Remove it again with:              Unregister-ScheduledTask -TaskName "ParaNews Daily Edition" -Confirm:$false
param([string]$Time = '06:00')

$project = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$log = Join-Path $project 'data\scrape.log'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" scripts\scrape.js --scheduled >> `"$log`" 2>&1`"" `
  -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off or asleep at print time, run as soon as it's back.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'ParaNews Daily Edition' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Scrapes the strange internet and prints today''s edition of The Para News.' -Force | Out-Null

Write-Host "Scheduled 'ParaNews Daily Edition' every day at $Time. Log: $log"
