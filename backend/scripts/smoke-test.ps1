<#
.SYNOPSIS
  Prueba de humo del backend TripPlanner AI ya DESPLEGADO (no se ejecuta en el sprint S1).

.DESCRIPTION
  1) Lee los Outputs del stack con aws cloudformation describe-stacks.
  2) Crea (o reutiliza) un usuario de prueba en Cognito y lo confirma con admin-confirm-sign-up.
  3) Obtiene el AccessToken con initiate-auth USER_PASSWORD_AUTH.
  4) Recorre la API (caso feliz y casos negativos) e imprime una tabla Paso / Esperado / Obtenido / OK.
  5) Con -Cleanup borra el viaje de prueba (cascada) y, solo si lo creo este script, el usuario.

  No imprime el token ni la contrasena. La contrasena se pide con Read-Host -AsSecureString y solo
  viaja en un archivo temporal (se borra al terminar) para que los caracteres especiales no se rompan.

.EXAMPLE
  .\smoke-test.ps1 -Email prueba.tripplanner@example.com -Cleanup
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$Profile = "agentic-workshop",
    [string]$Region = "us-east-2",
    [string]$StackName = "tripplanner-backend",
    [switch]$Cleanup
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ---------------------------------------------------------------- utilidades
function Invoke-Aws {
    param([string[]]$AwsArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $text = (& aws @AwsArgs --profile $Profile --region $Region 2>&1 | Out-String) } finally { $ErrorActionPreference = $previous }
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Text = $text.Trim() }
}

function Invoke-AwsJsonInput {
    # Pasa el cuerpo por --cli-input-json con un archivo temporal que se elimina siempre.
    param([string]$Service, [string]$Operation, [hashtable]$Body, [string[]]$Extra = @())
    $file = Join-Path ([IO.Path]::GetTempPath()) ("tp-smoke-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        [IO.File]::WriteAllText($file, ($Body | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
        $uri = "file://" + ($file -replace "\\", "/")
        Invoke-Aws -AwsArgs (@($Service, $Operation, "--cli-input-json", $uri) + $Extra)
    } finally {
        if (Test-Path $file) { Remove-Item $file -Force }
    }
}

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body = $null, [switch]$NoAuth)
    $headers = @{ "Content-Type" = "application/json" }
    if (-not $NoAuth) { $headers["Authorization"] = "Bearer $script:Token" }
    $params = @{ Method = $Method; Uri = "$script:ApiUrl$Path"; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 8 -Compress) }
    $status = 0; $content = ""
    try {
        $r = Invoke-WebRequest @params
        $status = [int]$r.StatusCode; $content = $r.Content
    } catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        $status = [int]$resp.StatusCode
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $content = $_.ErrorDetails.Message
        } else {
            try { $content = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch { $content = "" }
        }
    }
    $json = $null
    if ($content) { try { $json = $content | ConvertFrom-Json } catch { } }
    [pscustomobject]@{ Status = $status; Json = $json; Raw = $content }
}

$script:Results = New-Object System.Collections.Generic.List[object]
function Add-Result {
    param([string]$Step, [string]$Expected, [string]$Got, [bool]$Ok)
    $script:Results.Add([pscustomobject]@{ Paso = $Step; Esperado = $Expected; Obtenido = $Got; Resultado = $(if ($Ok) { "OK" } else { "FALLO" }) })
}

function Test-Status {
    param([string]$Step, $Response, [int]$Expected, [scriptblock]$Extra = $null)
    $ok = ($Response.Status -eq $Expected)
    $got = "HTTP $($Response.Status)"
    if ($ok -and $Extra) {
        $extraOk = $false
        try { $extraOk = [bool](& $Extra $Response) } catch { }
        if (-not $extraOk) { $ok = $false; $got += " (contenido inesperado)" }
    }
    Add-Result -Step $Step -Expected "HTTP $Expected" -Got $got -Ok $ok
}

# ---------------------------------------------------------------- 1) Outputs del stack
Write-Host "1) Leyendo los Outputs de '$StackName' ($Region)..."
$stack = Invoke-Aws -AwsArgs @("cloudformation", "describe-stacks", "--stack-name", $StackName, "--query", "Stacks[0].Outputs", "--output", "json")
if ($stack.ExitCode -ne 0) { throw "No se pudo leer el stack: $($stack.Text)" }
$out = @{}
foreach ($o in ($stack.Text | ConvertFrom-Json)) { $out[$o.OutputKey] = $o.OutputValue }
foreach ($k in "ApiUrl", "UserPoolId", "UserPoolClientId") { if (-not $out[$k]) { throw "Falta el Output $k" } }
$script:ApiUrl = $out["ApiUrl"].TrimEnd("/")
$poolId = $out["UserPoolId"]; $clientId = $out["UserPoolClientId"]
Write-Host "   API: $script:ApiUrl"

# ---------------------------------------------------------------- 2) Usuario de prueba
$secure = Read-Host -Prompt "Contrasena del usuario de prueba (min. 8, mayuscula, minuscula y numero)" -AsSecureString
$password = [System.Net.NetworkCredential]::new("", $secure).Password
$createdUser = $false
$tripId = $null
$script:Token = $null

try {
    Write-Host "2) Creando y confirmando el usuario de prueba..."
    $signUp = Invoke-AwsJsonInput -Service "cognito-idp" -Operation "sign-up" -Body @{
        ClientId = $clientId; Username = $Email; Password = $password
        UserAttributes = @(@{ Name = "email"; Value = $Email })
    }
    if ($signUp.ExitCode -eq 0) { $createdUser = $true }
    elseif ($signUp.Text -notmatch "UsernameExistsException") { throw "sign-up fallo: $($signUp.Text -replace [regex]::Escape($password), '***')" }
    else { Write-Host "   El usuario ya existia: se reutiliza (debe coincidir la contrasena)." }

    $confirm = Invoke-Aws -AwsArgs @("cognito-idp", "admin-confirm-sign-up", "--user-pool-id", $poolId, "--username", $Email)
    if ($confirm.ExitCode -ne 0 -and $confirm.Text -notmatch "NotAuthorizedException") { throw "admin-confirm-sign-up fallo: $($confirm.Text)" }

    # ------------------------------------------------------------ 3) Token
    Write-Host "3) Obteniendo el access token..."
    $auth = Invoke-AwsJsonInput -Service "cognito-idp" -Operation "initiate-auth" -Body @{
        AuthFlow = "USER_PASSWORD_AUTH"; ClientId = $clientId
        AuthParameters = @{ USERNAME = $Email; PASSWORD = $password }
    } -Extra @("--query", "AuthenticationResult.AccessToken", "--output", "text")
    if ($auth.ExitCode -ne 0 -or -not $auth.Text -or $auth.Text -eq "None") { throw "initiate-auth fallo (revisa la contrasena)." }
    $script:Token = $auth.Text

    # ------------------------------------------------------------ 4) API
    Write-Host "4) Recorriendo la API..."
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $start = (Get-Date).AddDays(30).ToString("yyyy-MM-dd", $inv)
    $end = (Get-Date).AddDays(33).ToString("yyyy-MM-dd", $inv)
    $day2 = (Get-Date).AddDays(31).ToString("yyyy-MM-dd", $inv)
    $bogota = "Bogot$([char]0x00E1)"

    $trip = @{ title = "Prueba de humo"; origin = $bogota; destination = "Cartagena"; startDate = $start; endDate = $end
               travelers = 3; budget = 5000000; currency = "COP" }

    $r = Invoke-Api POST "/trips" $trip
    Test-Status "POST /trips" $r 201 { param($x) $x.Json.trip.tripId -match "^TRP-[0-9a-f]{8}$" -and $x.Json.trip.status -eq "PLANNED" }
    if ($r.Status -eq 201) { $tripId = $r.Json.trip.tripId }

    $r = Invoke-Api GET "/trips"
    Test-Status "GET /trips" $r 200 { param($x) @($x.Json.trips | Where-Object { $_.tripId -eq $tripId }).Count -eq 1 }

    if ($tripId) {
        $itinerary = @{ days = @(
            @{ date = $start; items = @(@{ time = "07:15"; title = "Vuelo a Cartagena"; type = "flight"; location = "El Dorado" }) },
            @{ date = $day2; items = @(@{ time = "09:00"; title = "Ciudad amurallada"; type = "activity" }) }) }
        $r = Invoke-Api POST "/trips/$tripId/itinerary" $itinerary
        Test-Status "POST /trips/{id}/itinerary (2 dias)" $r 201 { param($x) @($x.Json.itinerary.days).Count -eq 2 }

        $reservation = @{ type = "FLIGHT"; status = "SIMULADA"; provider = "Avianca"; price = 289000; currency = "COP"
                          details = @{ airline = "Avianca"; flightNumber = "AV9821"; origin = "BOG"; destination = "CTG"
                                       departureTime = "${start}T07:15"; bookingUrl = "https://www.kiwi.com/" } }
        $r = Invoke-Api POST "/trips/$tripId/reservations" $reservation
        Test-Status "POST /trips/{id}/reservations (FLIGHT, SIMULADA)" $r 201 { param($x) $x.Json.reservation.status -eq "SIMULADA" }
        $resId = if ($r.Status -eq 201) { $r.Json.reservation.resId } else { $null }

        $r = Invoke-Api GET "/reservations"
        Test-Status "GET /reservations" $r 200 { param($x) @($x.Json.reservations | Where-Object { $_.resId -eq $resId }).Count -eq 1 }

        if ($resId) {
            $r = Invoke-Api PUT "/trips/$tripId/reservations/$resId" @{ status = "PENDIENTE" }
            Test-Status "PUT reserva -> PENDIENTE" $r 200 { param($x) $x.Json.reservation.status -eq "PENDIENTE" }
        }

        $r = Invoke-Api GET "/trips/$tripId"
        Test-Status "GET /trips/{id} (viaje + itinerario + reservas)" $r 200 {
            param($x) $x.Json.trip.tripId -eq $tripId -and $null -ne $x.Json.itinerary -and @($x.Json.reservations).Count -eq 1 }
    }

    # Negativas
    $r = Invoke-Api GET "/trips" -NoAuth
    Test-Status "Negativa: GET /trips sin token" $r 401
    $past = $trip.Clone(); $past["startDate"] = "2020-01-01"; $past["endDate"] = "2020-01-03"
    $r = Invoke-Api POST "/trips" $past
    Test-Status "Negativa: fecha pasada" $r 400 { param($x) $x.Json.error.code -eq "VALIDATION_ERROR" }
    $card = $trip.Clone(); $card["cardNumber"] = "4111111111111111"
    $r = Invoke-Api POST "/trips" $card
    Test-Status "Negativa: campo cardNumber" $r 400
    $r = Invoke-Api GET "/trips/TRP-00000000"
    Test-Status "Negativa: tripId inexistente" $r 404 { param($x) $x.Json.error.code -eq "NOT_FOUND" }
}
finally {
    # ------------------------------------------------------------ 6) Limpieza
    if ($Cleanup) {
        Write-Host "6) Limpieza..."
        if ($tripId -and $script:Token) {
            $r = Invoke-Api DELETE "/trips/$tripId"
            Test-Status "Limpieza: DELETE /trips/{id} (cascada)" $r 204
        }
        if ($createdUser) {
            $d = Invoke-Aws -AwsArgs @("cognito-idp", "admin-delete-user", "--user-pool-id", $poolId, "--username", $Email)
            Add-Result -Step "Limpieza: admin-delete-user" -Expected "exit 0" -Got "exit $($d.ExitCode)" -Ok ($d.ExitCode -eq 0)
        } else {
            Write-Host "   El usuario ya existia antes de la prueba: no se elimina."
        }
    }
    $password = $null; $script:Token = $null
}

# ---------------------------------------------------------------- 5) Resultados
Write-Host ""
$script:Results | Format-Table -AutoSize -Wrap
$failed = @($script:Results | Where-Object { $_.Resultado -eq "FALLO" }).Count
if ($failed -gt 0) { Write-Host "$failed paso(s) con FALLO." -ForegroundColor Red; exit 1 }
Write-Host "Todos los pasos OK." -ForegroundColor Green
