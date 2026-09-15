param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$EncryptionPassword
)

$ErrorActionPreference = 'Stop'
$resolvedDestination = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $resolvedDestination | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpPath = Join-Path $resolvedDestination "bj-burgers-$timestamp.dump"

pg_dump --format=custom --no-owner --dbname=$DatabaseUrl --file=$dumpPath
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

openssl enc -aes-256-cbc -salt -pbkdf2 -in $dumpPath -out "$dumpPath.enc" -pass "pass:$EncryptionPassword"
if ($LASTEXITCODE -ne 0) { throw 'backup encryption failed' }

Remove-Item -LiteralPath $dumpPath
Get-ChildItem -LiteralPath $resolvedDestination -Filter '*.dump.enc' |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) |
  Remove-Item -Force
