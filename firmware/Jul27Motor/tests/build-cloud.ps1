param(
  [string]$Cli = 'C:/Program Files/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe',
  [string]$DataDirectory = 'C:/Users/debut/AppData/Local/Arduino15',
  [string]$UserDirectory = 'C:/Users/debut/Documents/Arduino',
  [ValidateSet('right','left')][string[]]$Arms = @('right','left'),
  [switch]$LinkTest
)
$ErrorActionPreference = 'Stop'
$firmware = Split-Path $PSScriptRoot
$buildRoot = Join-Path $firmware '.build'
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
$config = Join-Path $buildRoot 'arduino-cloud.yaml'
$downloads = (Join-Path $buildRoot 'downloads').Replace('\','/')
$cache = (Join-Path $buildRoot 'cache').Replace('\','/')
@"
directories:
  data: $($DataDirectory.Replace('\','/'))
  downloads: $downloads
  user: $($UserDirectory.Replace('\','/'))
build_cache:
  path: $cache
"@ | Set-Content -LiteralPath $config
$report = Join-Path $buildRoot 'cloud-build-results.json'
$results = @()
if(Test-Path -LiteralPath $report) { $results=@(Get-Content -LiteralPath $report -Raw | ConvertFrom-Json) }
foreach ($arm in $Arms) {
  # Same exact source/build paths retain Arduino's compiled library cache.
  $stage = Join-Path $buildRoot 'cloud-source-right/Jul27Motor'
  $buildPath = Join-Path $buildRoot 'cloud-build-right'
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  # Retire the Sheets uploader from reused staging directories as well.
  foreach ($name in @('Telemetry.cpp','Telemetry.h')) {
    $retiredSource = Join-Path $stage $name
    if (Test-Path -LiteralPath $retiredSource) { Remove-Item -LiteralPath $retiredSource }
  }
  # Never retain an old provisioned header if it was removed from the source.
  if (!(Test-Path -LiteralPath (Join-Path $firmware 'CloudConfig.h'))) {
    $staleConfig = Join-Path $stage 'CloudConfig.h'
    if (Test-Path -LiteralPath $staleConfig) { Remove-Item -LiteralPath $staleConfig }
  }
  if (!(Test-Path -LiteralPath (Join-Path $firmware 'WifiConfig.h'))) {
    $staleWifi = Join-Path $stage 'WifiConfig.h'
    if (Test-Path -LiteralPath $staleWifi) { Remove-Item -LiteralPath $staleWifi }
  }
  # Explicit file-only staging prevents Arduino from recursively copying .build.
  Get-ChildItem -LiteralPath $firmware -File |
    Where-Object { $_.Extension -in '.ino','.cpp','.h' } |
    Copy-Item -Destination $stage
  $mainPath = Join-Path $stage 'Jul27Motor.ino'
  $main = Get-Content -LiteralPath $mainPath -Raw
  $main = [regex]::Replace($main,'(?m)^[ \t]*#define[ \t]+ARM_IS_LEFT\b[^\r\n]*','')
  if ($arm -eq 'left') { $main = "#define ARM_IS_LEFT`n" + $main }
  Set-Content -LiteralPath $mainPath -Value $main
  if($LinkTest) {
    # Forces the transport to link without introducing any usable credentials.
    # Never flash these synthetic binaries. This header exists only in .build.
    @'
#pragma once
#define CLOUD_API_BASE "https://compile-check.invalid"
#define CLOUD_DEVICE_KEY "compile-only-not-a-real-credential-000000000000000000000000"
#define CLOUD_ROOT_CA "-----BEGIN CERTIFICATE-----\ncompile-only-invalid\n-----END CERTIFICATE-----"
#define CLOUD_PAIR_ID 1UL
#define CLOUD_PEER_MAC {2,0,0,0,0,1}
#define CLOUD_ESPNOW_PMK {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16}
#define CLOUD_ESPNOW_LMK {16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}
'@ | Set-Content -LiteralPath (Join-Path $stage 'CloudConfig.h')
  }
  $arguments = @('compile','--config-file',$config,'--fqbn','esp32:esp32:esp32s3:CDCOnBoot=cdc',
    '--jobs','4','--build-path',$buildPath)
  $arguments += $stage
  $mode = if($LinkTest) { 'link-test' } else { 'default' }
  $name = if($LinkTest) { "cloud-link-$arm" } else { "cloud-$arm" }
  $log = Join-Path $buildRoot "$name.log"
  $sourceHashes = @{}
  Get-ChildItem -LiteralPath $stage -File | ForEach-Object { $sourceHashes[$_.Name]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  & $Cli @arguments *> $log
  $code = $LASTEXITCODE
  Get-Content -LiteralPath $log -Tail 40
  $logText=Get-Content -LiteralPath $log -Raw
  $flashMatch=[regex]::Match($logText,'Sketch uses (\d+) bytes')
  $ramMatch=[regex]::Match($logText,'Global variables use (\d+) bytes')
  $outputPath=Join-Path $buildRoot "verified-$name"
  New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
  $binaryHash=$null
  if($code -eq 0) {
    Get-ChildItem -LiteralPath $buildPath -File | Where-Object { $_.Extension -in '.bin','.elf','.map' } | Copy-Item -Destination $outputPath
    $binaryHash=(Get-FileHash -LiteralPath (Join-Path $outputPath 'Jul27Motor.ino.bin') -Algorithm SHA256).Hash
  }
  $results=@($results | Where-Object { !($_.arm -eq $arm -and ($_.mode -eq $mode -or !$_.mode)) })
  $configuration=if($LinkTest) { 'synthetic-unusable' } elseif(Test-Path -LiteralPath (Join-Path $stage 'CloudConfig.h')) { 'local-config' } else { 'unconfigured' }
  $results += [pscustomobject]@{
    arm=$arm; mode=$mode; configuration=$configuration; fqbn='esp32:esp32:esp32s3:CDCOnBoot=cdc'; partition='default';
    exit_code=$code; flash_bytes=if($flashMatch.Success) { [int]$flashMatch.Groups[1].Value } else { $null };
    static_ram_bytes=if($ramMatch.Success) { [int]$ramMatch.Groups[1].Value } else { $null };
    log=$log; flashed=$false; verified_utc=[DateTime]::UtcNow.ToString('o');
    source_sha256=$sourceHashes; binary_sha256=$binaryHash; artifacts=$outputPath
  }
  $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report
  if ($code -ne 0) { throw "$arm firmware compile failed; see $log" }
}
