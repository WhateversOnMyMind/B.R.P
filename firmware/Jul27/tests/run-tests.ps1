param([string]$Compiler = 'C:\Program Files\GNU Octave\Octave-10.3.0\mingw64\bin\g++.exe')
$ErrorActionPreference = 'Stop'
$env:PATH = (Split-Path $Compiler) + ';' + $env:PATH
Push-Location $PSScriptRoot
try {
  $configTests = Join-Path (Split-Path $PSScriptRoot) '.build/cloud-settings-tests'
  New-Item -ItemType Directory -Force -Path $configTests | Out-Null
  Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot) 'CloudSettings.h') -Destination (Join-Path $configTests 'CloudSettings.h')
  foreach ($case in 0..5) {
    $exe = Join-Path $configTests "case-$case.exe"
    & $Compiler -std=c++17 -Wall -Wextra -Werror "-DTEST_CONFIG_CASE=$case" -I $configTests 'cloud_settings_test.cpp' -o $exe
    if ($LASTEXITCODE -ne 0) { throw "Cloud settings compile failed: $case" }
    & $exe
    if ($LASTEXITCODE -ne 0) { throw "Cloud settings test failed: $case" }
  }
  foreach ($suite in @('telemetry_timing_test','alert_window_test','cloud_command_test','peer_protocol_test','capture_timing_test','piezo_feedback_test')) {
    & $Compiler -std=c++17 -Wall -Wextra -Werror "$suite.cpp" -o "$suite.exe"
    if ($LASTEXITCODE -ne 0) { throw "Compile failed: $suite" }
  }
  & .\telemetry_timing_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Timing tests failed' }
  & .\alert_window_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Alert tests failed' }
  & .\cloud_command_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Cloud command tests failed' }
  & .\peer_protocol_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Peer protocol tests failed' }
  & .\capture_timing_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Capture timing tests failed' }
  & .\piezo_feedback_test.exe
  if ($LASTEXITCODE -ne 0) { throw 'Piezo feedback tests failed' }
} finally { Pop-Location }
