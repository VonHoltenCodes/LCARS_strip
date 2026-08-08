# LCARS_strip node agent — windows_exporter for Windows 10/11.
# Run in an ELEVATED PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\install-windows-exporter.ps1 -PanelIP 192.168.1.10
param(
  [Parameter(Mandatory=$true)][string]$PanelIP,   # the LCARS_strip panel host
  [string]$Version = '0.31.7'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url = "https://github.com/prometheus-community/windows_exporter/releases/download/v$Version/windows_exporter-$Version-amd64.msi"
$msi = Join-Path $env:TEMP 'windows_exporter.msi'
Write-Output "downloading windows_exporter $Version ..."
Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing

Write-Output "installing (msiexec) ..."
$collectors = 'cpu,cpu_info,memory,logical_disk,net,os,system,tcp,time,thermalzone,pagefile,cache'
$p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" ENABLED_COLLECTORS=`"$collectors`" LISTEN_PORT=9182 /qn /norestart" -Wait -PassThru
Write-Output ("msiexec_exit=" + $p.ExitCode)
Start-Sleep 6
$svc = Get-Service windows_exporter -ErrorAction SilentlyContinue
if ($svc) { Write-Output ("service=" + $svc.Status + " start=" + $svc.StartType) } else { Write-Output "service=NOT_FOUND"; exit 1 }

# firewall: 9182 from the panel host ONLY
Get-NetFirewallRule -DisplayName 'LCARS_strip exporters (panel host only)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'LCARS_strip exporters (panel host only)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9182,9835 -RemoteAddress $PanelIP -Profile Any | Out-Null
Write-Output "firewall=9182,9835 allowed from $PanelIP only"

# local scrape sanity
try { $m = (Invoke-WebRequest -UseBasicParsing http://localhost:9182/metrics -TimeoutSec 10).Content
      Write-Output ("metrics_lines=" + ($m -split "`n").Count) }
catch { Write-Output ("scrape_fail=" + $_.Exception.Message) }
Write-Output "done — add this PC on the panel: ⚙ NODES → its IP → SCAN"
