param(
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'release',
  [string]$Architectures = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

if ($Variant -eq 'release') {
  foreach ($variable in 'BJ_ANDROID_KEYSTORE', 'BJ_ANDROID_KEYSTORE_PASSWORD', 'BJ_ANDROID_KEY_ALIAS', 'BJ_ANDROID_KEY_PASSWORD') {
    if (-not [Environment]::GetEnvironmentVariable($variable)) {
      throw "Falta $variable. No se generará un APK release que no pueda actualizar la aplicación instalada."
    }
  }
  if (-not (Test-Path -LiteralPath $env:BJ_ANDROID_KEYSTORE)) { throw "No existe el archivo indicado por BJ_ANDROID_KEYSTORE." }
}

if (-not $env:NODE_ENV) {
  $env:NODE_ENV = if ($Variant -eq 'release') { 'production' } else { 'development' }
}

pnpm exec expo prebuild --platform android --no-install
$propertiesPath = Join-Path $projectRoot 'android\signing.properties'
if ($Variant -eq 'release') {
  @(
    "storeFile=$($env:BJ_ANDROID_KEYSTORE.Replace('\', '\\'))",
    "storePassword=$env:BJ_ANDROID_KEYSTORE_PASSWORD",
    "keyAlias=$env:BJ_ANDROID_KEY_ALIAS",
    "keyPassword=$env:BJ_ANDROID_KEY_PASSWORD"
  ) | Set-Content -LiteralPath $propertiesPath
}
try {
  if ($Variant -eq 'release') {
    & .\android\gradlew.bat -p android --no-parallel "-PreactNativeArchitectures=$Architectures" :app:assembleRelease
    $apkPath = 'android\app\build\outputs\apk\release\app-release.apk'
  } else {
    & .\android\gradlew.bat -p android --no-parallel "-PreactNativeArchitectures=$Architectures" :app:assembleDebug
    $apkPath = 'android\app\build\outputs\apk\debug\app-debug.apk'
  }
  if ($LASTEXITCODE -ne 0) { throw "Gradle no pudo generar el APK $Variant." }
  if (-not (Test-Path -LiteralPath $apkPath)) { throw "Gradle terminó sin crear $apkPath." }
  Write-Output "APK: $apkPath"
} finally { Remove-Item -LiteralPath $propertiesPath -Force -ErrorAction SilentlyContinue }
