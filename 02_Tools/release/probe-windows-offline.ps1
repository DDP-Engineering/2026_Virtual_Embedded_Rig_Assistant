param(
  [Parameter(Mandatory=$true)][string]$Artifact,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$stage = 'artifact-verification'
$actual = $null
$result = @{ status='failed'; artifactSha256=$ExpectedSha256 }
try {
  $artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
  $actual = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256) { throw 'Artifact hash mismatch' }
  @{ sha256=$actual; bytes=(Get-Item -LiteralPath $artifactPath).Length } |
    ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $evidence 'artifact-before.json')
  $stage = 'isolation-verification'
  $adapters = @(Get-NetAdapter -IncludeHidden | Select-Object Name,Status,InterfaceDescription,InterfaceIndex)
  $interfaces = @(Get-NetIPInterface -IncludeAllCompartments | Select-Object InterfaceIndex,InterfaceAlias,ConnectionState,CompartmentId)
  $routes = @(Get-NetRoute -IncludeAllCompartments | Select-Object DestinationPrefix,NextHop,InterfaceAlias,InterfaceIndex)
  # Identify loopback by its well-known IPv4 address rather than a localized interface name.
  $loopback = @(Get-NetIPAddress -IncludeAllCompartments -AddressFamily IPv4 | Where-Object IPAddress -eq '127.0.0.1' | Select-Object -ExpandProperty InterfaceIndex)
  @{ artifactSha256=$actual; os=[Environment]::OSVersion.ToString(); adapters=$adapters; interfaces=$interfaces; routes=$routes;
     isolation='Externally isolated Windows; all network adapters down or absent'; timestamp=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $evidence 'isolation.json')
  if (@($adapters | Where-Object Status -eq 'Up').Count -gt 0) { throw 'Unexpected active network adapter; isolate the VM externally before running' }
  if (@($interfaces | Where-Object { $_.ConnectionState -eq 'Connected' -and $_.InterfaceIndex -notin $loopback }).Count -gt 0) { throw 'Unexpected connected non-loopback IP interface' }
  if (@($routes | Where-Object { $_.InterfaceIndex -notin $loopback }).Count -gt 0) { throw 'Unexpected non-loopback route' }
  $stage = 'extraction'
  $destination = Join-Path ([IO.Path]::GetTempPath()) ('VERA offline package ' + [Guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $artifactPath -DestinationPath $destination
  $exe = Join-Path $destination 'VERA.exe'
  $stage = 'application-launch'
  $arguments = @(( '--packaging-probe="' + (Join-Path $evidence 'probe.json') + '"'), ('--user-data-dir="' + (Join-Path $destination 'user-data') + '"'))
  $run = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $evidence 'stdout.log') -RedirectStandardError (Join-Path $evidence 'stderr.log')
  $stage = 'application-probe'
  if (-not $run.WaitForExit(600000)) { $run.Kill(); throw 'Packaged probe exceeded 10-minute process deadline' }
  if ($run.ExitCode -ne 0) { throw "Packaged probe exited $($run.ExitCode)" }
  $probe = Get-Content -LiteralPath (Join-Path $evidence 'probe.json') -Raw | ConvertFrom-Json
  if ($probe.status -ne 'passed' -or -not $probe.packaged) { throw 'Missing successful packaged result' }
  $result.status = 'passed'
  $result.exitCode = $run.ExitCode
} catch {
  $result.error = $_.Exception.Message
  $result.stage = $stage
} finally {
  if ($actual) {
    $after = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    @{ sha256=$after } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $evidence 'artifact-after.json')
    if ($after -ne $actual) { $result.status='failed'; $result.error='Artifact changed during execution'; $result.stage='final-hash' }
  }
  $result | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $evidence 'completion.json')
}
if ($result.status -ne 'passed') { exit 1 }
