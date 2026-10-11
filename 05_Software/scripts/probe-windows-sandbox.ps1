param(
  [Parameter(Mandatory=$true)][string]$Artifact,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
  [switch]$Launch
)
$ErrorActionPreference = 'Stop'
$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
if ([IO.Path]::GetExtension($artifactPath) -ne '.zip') { throw 'Expected the instrumented Windows zip' }
$evidencePath = [IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null
$hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$file = [IO.Path]::GetFileName($artifactPath)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'probe-windows-offline.ps1') -Destination (Join-Path $evidencePath 'probe-windows-offline.ps1') -Force
$guest = "& 'C:\VERA-evidence\probe-windows-offline.ps1' -Artifact 'C:\VERA-input\" + $file.Replace("'", "''") + "' -ExpectedSha256 '" + $hash + "' -EvidenceDirectory 'C:\VERA-evidence'"
Set-Content -LiteralPath (Join-Path $evidencePath 'guest-probe.ps1') -Value $guest -Encoding UTF8
$inputEscaped = [Security.SecurityElement]::Escape([IO.Path]::GetDirectoryName($artifactPath))
$outputEscaped = [Security.SecurityElement]::Escape($evidencePath)
$config = @"
<Configuration>
  <Networking>Disable</Networking>
  <vGPU>Disable</vGPU>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <MappedFolders>
    <MappedFolder><HostFolder>$inputEscaped</HostFolder><SandboxFolder>C:\VERA-input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$outputEscaped</HostFolder><SandboxFolder>C:\VERA-evidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\VERA-evidence\guest-probe.ps1</Command></LogonCommand>
</Configuration>
"@
$configPath = Join-Path $evidencePath 'VERA-offline.wsb'
Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8
@{ artifact=$artifactPath; artifactSha256=$hash; configurationSha256=(Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant() } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidencePath 'host.json') -Encoding UTF8
if ($Launch) { Start-Process -FilePath WindowsSandbox.exe -ArgumentList ('"' + $configPath + '"') -WindowStyle Hidden }
Write-Output $configPath
