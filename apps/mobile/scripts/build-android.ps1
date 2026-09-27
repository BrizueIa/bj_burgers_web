param(
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'release',
  [string]$Architectures = 'arm64-v8a',
  [string]$GradleInitScript
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot
$propertiesPath = Join-Path $projectRoot 'android\signing.properties'
$hadSigningProperties = Test-Path -LiteralPath $propertiesPath
$originalSigningProperties = if ($hadSigningProperties) {
  [System.IO.File]::ReadAllText($propertiesPath)
} else {
  $null
}
$signingVariables = 'BJ_ANDROID_KEYSTORE', 'BJ_ANDROID_KEYSTORE_PASSWORD', 'BJ_ANDROID_KEY_ALIAS', 'BJ_ANDROID_KEY_PASSWORD'
$hasEnvironmentSigning = ($signingVariables | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }).Count -eq 0

if ($Variant -eq 'release') {
  if ($hasEnvironmentSigning) {
    if (-not (Test-Path -LiteralPath $env:BJ_ANDROID_KEYSTORE)) {
      throw 'No existe el archivo indicado por BJ_ANDROID_KEYSTORE.'
    }
  } elseif ($hadSigningProperties) {
    $existingProperties = @{}
    foreach ($line in ($originalSigningProperties -split '\r?\n')) {
      if ($line -match '^([^#!][^=]*)=(.*)$') { $existingProperties[$matches[1].Trim()] = $matches[2] }
    }
    foreach ($name in 'storeFile', 'storePassword', 'keyAlias', 'keyPassword') {
      if ([string]::IsNullOrWhiteSpace($existingProperties[$name])) {
        throw "Falta $name en android/signing.properties. No se generará un APK release que no pueda actualizar la aplicación instalada."
      }
    }
  } else {
    throw 'Falta la firma original: configura las variables BJ_ANDROID_* o restaura android/signing.properties. No se generará un APK release con otra firma.'
  }
}

if (-not $env:NODE_ENV) {
  $env:NODE_ENV = if ($Variant -eq 'release') { 'production' } else { 'development' }
}

try {
  pnpm exec expo prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild no pudo preparar el proyecto Android.' }

  if ($Variant -eq 'release' -and $hasEnvironmentSigning) {
    @(
      "storeFile=$($env:BJ_ANDROID_KEYSTORE.Replace('\', '\\'))",
      "storePassword=$env:BJ_ANDROID_KEYSTORE_PASSWORD",
      "keyAlias=$env:BJ_ANDROID_KEY_ALIAS",
      "keyPassword=$env:BJ_ANDROID_KEY_PASSWORD"
    ) | Set-Content -LiteralPath $propertiesPath
  } elseif ($Variant -eq 'release' -and $hadSigningProperties) {
    [System.IO.File]::WriteAllText($propertiesPath, $originalSigningProperties)
  }

  $gradleArguments = @()
  if ($GradleInitScript) {
    if (-not (Test-Path -LiteralPath $GradleInitScript)) {
      throw "No existe el script de inicialización Gradle: $GradleInitScript."
    }
    $gradleArguments += @('--init-script', (Resolve-Path -LiteralPath $GradleInitScript).Path)
  }
  if ($Variant -eq 'release') {
    & .\android\gradlew.bat @gradleArguments -p android --no-parallel "-PreactNativeArchitectures=$Architectures" :app:assembleRelease
    $apkPath = 'android\app\build\outputs\apk\release\app-release.apk'
  } else {
    & .\android\gradlew.bat @gradleArguments -p android --no-parallel "-PreactNativeArchitectures=$Architectures" :app:assembleDebug
    $apkPath = 'android\app\build\outputs\apk\debug\app-debug.apk'
  }
  if ($LASTEXITCODE -ne 0) { throw "Gradle no pudo generar el APK $Variant." }
  if (-not (Test-Path -LiteralPath $apkPath)) { throw "Gradle terminó sin crear $apkPath." }
  Write-Output "APK: $apkPath"
} finally {
  if ($hadSigningProperties) {
    [System.IO.File]::WriteAllText($propertiesPath, $originalSigningProperties)
  } elseif ($Variant -eq 'release') {
    Remove-Item -LiteralPath $propertiesPath -Force -ErrorAction SilentlyContinue
  }
}
