param(
  [Parameter(Mandatory)][string] $CaptureRoot,
  [Parameter(Mandatory)][string] $CaptureName,
  [Parameter(Mandatory)][ValidateSet('inspect', 'close', 'list')][string] $Action
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$capturePrefix = [System.IO.Path]::GetFullPath($CaptureRoot) + [System.IO.Path]::DirectorySeparatorChar
$native = Get-CimInstance Win32_Process -Filter "Name = 'Wireshark.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($capturePrefix) -and $_.CommandLine.Contains($CaptureName) }
foreach ($entry in $native) {
  if ($Action -eq 'list') {
    $entry.ProcessId
    continue
  }
  $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
  if (!$process) { continue }
  if ($Action -eq 'close') {
    if (!$process.CloseMainWindow() -or !$process.WaitForExit(4000)) { Stop-Process -Id $process.Id }
    continue
  }
  if (!$process.MainWindowHandle) { continue }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $nodes = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $window.Current.Name
  foreach ($node in $nodes) {
    $value = $null
    if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
      $value.Current.Value
    }
    $node.Current.Name
  }
}
