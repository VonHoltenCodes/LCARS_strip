# LCARS_strip node agent — NVIDIA GPU exporter (optional; needs nvidia-smi).
# Run AFTER install-windows-exporter.ps1, in an ELEVATED PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\install-nvidia-gpu-exporter.ps1
# (the firewall rule from the windows_exporter script already covers port 9835)
param(
  [string]$NgeVersion = '1.13.1',
  [string]$ShawlVersion = '1.9.0'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dir = 'C:\Program Files\nvidia_gpu_exporter'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$ngeZip = Join-Path $env:TEMP 'nge.zip'
Invoke-WebRequest "https://github.com/utkuozdemir/nvidia_gpu_exporter/releases/download/v$NgeVersion/nvidia_gpu_exporter_${NgeVersion}_windows_x86_64.zip" -OutFile $ngeZip -UseBasicParsing
Expand-Archive -Path $ngeZip -DestinationPath $dir -Force

# shawl wraps the exporter as a proper Windows service
$shZip = Join-Path $env:TEMP 'shawl.zip'
Invoke-WebRequest "https://github.com/mtkennerly/shawl/releases/download/v$ShawlVersion/shawl-v$ShawlVersion-win64.zip" -OutFile $shZip -UseBasicParsing
Expand-Archive -Path $shZip -DestinationPath $dir -Force

$exe   = (Get-ChildItem $dir -Filter 'nvidia_gpu_exporter*.exe' -Recurse | Select-Object -First 1).FullName
$shawl = (Get-ChildItem $dir -Filter 'shawl.exe' -Recurse | Select-Object -First 1).FullName

Get-Service nvidia_gpu_exporter -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Service $_ -Force -ErrorAction SilentlyContinue; & sc.exe delete nvidia_gpu_exporter | Out-Null; Start-Sleep 2 }
& $shawl add --name nvidia_gpu_exporter -- $exe --web.listen-address ':9835' | Out-Null
Set-Service nvidia_gpu_exporter -StartupType Automatic
Start-Service nvidia_gpu_exporter
Start-Sleep 5
$svc = Get-Service nvidia_gpu_exporter -ErrorAction SilentlyContinue
Write-Output ("service=" + $svc.Status + " start=" + $svc.StartType)
try { $m = (Invoke-WebRequest -UseBasicParsing http://localhost:9835/metrics -TimeoutSec 10).Content
      Write-Output ('gpu_metrics_lines=' + ($m -split "`n").Count) }
catch { Write-Output ('gpu_scrape_fail=' + $_.Exception.Message) }
Write-Output "done — set gpu=true on this node (SCAN detects it automatically)"
