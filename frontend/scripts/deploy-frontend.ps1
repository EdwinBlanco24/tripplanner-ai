<#
.SYNOPSIS
  Publica el frontend (build de Vite) en el bucket S3 del stack tripplanner-frontend y invalida CloudFront.

.DESCRIPTION
  1. Lee los Outputs del stack (bucket, distribucion, dominio).
  2. Ejecuta npm run build.
  3. Sube dist\ a S3 con Cache-Control por tipo de archivo:
       assets\*          public, max-age=31536000, immutable
       index.html y config.json (y otros archivos de la raiz)   no-cache
       data\cities.json  public, max-age=86400
  4. Invalida /index.html y /config.json en CloudFront (y /* con -FullInvalidation) y espera a que termine.
  5. Imprime la URL final.
  Se detiene ante cualquier error. NO se ejecuta solo: lanzalo a mano cuando el stack ya exista.

.EXAMPLE
  .\scripts\deploy-frontend.ps1
  .\scripts\deploy-frontend.ps1 -FullInvalidation
#>
[CmdletBinding()]
param(
  [string]$StackName = 'tripplanner-frontend',
  [string]$Profile = 'agentic-workshop',
  [string]$Region = 'us-east-2',
  [switch]$FullInvalidation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$FrontendDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $FrontendDir 'dist'

function Invoke-Aws {
  # Ejecuta aws con el perfil y la region; si falla, detiene el script con un mensaje claro.
  param([Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$AwsArgs)
  $output = & aws @AwsArgs --profile $Profile --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Fallo el comando: aws $($AwsArgs -join ' ') (codigo $LASTEXITCODE)." }
  return $output
}

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }

try {
  Write-Step "Leyendo los Outputs del stack '$StackName' ($Region)"
  $raw = Invoke-Aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' --output json
  $stack = ($raw -join "`n") | ConvertFrom-Json
  if ($stack.Status -notmatch '_COMPLETE$' -or $stack.Status -match 'ROLLBACK') {
    throw "El stack esta en estado $($stack.Status). Corrigelo antes de publicar."
  }
  $out = @{}
  foreach ($o in $stack.Outputs) { $out[$o.OutputKey] = $o.OutputValue }
  foreach ($k in 'BucketName', 'DistributionId', 'DistributionDomainName') {
    if (-not $out.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($out[$k])) { throw "Falta el Output '$k' en el stack." }
  }
  $bucket = $out['BucketName']
  $distributionId = $out['DistributionId']
  $domain = $out['DistributionDomainName']
  Write-Host "Bucket: $bucket"
  Write-Host "Distribucion: $distributionId ($domain)"

  Write-Step 'Compilando el frontend (npm run build)'
  Push-Location $FrontendDir
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build fallo (codigo $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path (Join-Path $DistDir 'index.html'))) { throw "No existe dist\index.html despues del build." }

  Write-Step 'Subiendo archivos a S3'
  $s3 = "s3://$bucket"
  # 1) assets con huella (sin borrar todavia: los clientes con el index.html anterior aun los piden)
  Invoke-Aws s3 sync (Join-Path $DistDir 'assets') "$s3/assets" --cache-control 'public, max-age=31536000, immutable' | Out-Host
  # 2) datos
  if (Test-Path (Join-Path $DistDir 'data')) {
    Invoke-Aws s3 sync (Join-Path $DistDir 'data') "$s3/data" --delete --cache-control 'public, max-age=86400' | Out-Host
  }
  # 3) raiz (index.html, config.json y lo demas): sin cache; va despues de los assets
  Invoke-Aws s3 sync $DistDir $s3 --exclude 'assets/*' --exclude 'data/*' --delete --cache-control 'no-cache' | Out-Host
  # 4) ahora si: retirar los assets antiguos
  Invoke-Aws s3 sync (Join-Path $DistDir 'assets') "$s3/assets" --delete --cache-control 'public, max-age=31536000, immutable' | Out-Host

  Write-Step 'Invalidando CloudFront'
  $paths = @('/index.html', '/config.json')
  if ($FullInvalidation) { $paths = @('/*') }
  $inv = (Invoke-Aws cloudfront create-invalidation --distribution-id $distributionId --paths @paths --query 'Invalidation.Id' --output text)
  $invId = ($inv -join '').Trim()
  Write-Host "Invalidacion creada: $invId (rutas: $($paths -join ', '))"
  Write-Host 'Esperando a que termine (puede tardar uno o dos minutos)...'
  & aws cloudfront wait invalidation-completed --distribution-id $distributionId --id $invId --profile $Profile --region $Region
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "No se pudo confirmar el fin de la invalidacion. Consulta su estado con: aws cloudfront get-invalidation --distribution-id $distributionId --id $invId --profile $Profile"
  } else {
    Write-Host 'Invalidacion completada.' -ForegroundColor Green
  }

  Write-Host "`nPublicado. URL: https://$domain" -ForegroundColor Green
}
catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
