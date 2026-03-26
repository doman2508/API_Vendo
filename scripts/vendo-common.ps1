$ErrorActionPreference = "Stop"

function Get-VendoConfig {
    $config = @{
        BaseUrl = "http://localhost:8080"
        ApiLogin = ""
        ApiPassword = ""
        VendoUserLogin = ""
        VendoUserPassword = ""
    }

    return $config
}

function Get-SettingValue {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Value,

        [Parameter(Mandatory = $true)]
        [string] $EnvName
    )

    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $envValue = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($envValue)) {
        throw "Brakuje wartosci '$EnvName'. Uzupelnij ja w sekcji konfiguracji skryptu albo ustaw zmienna srodowiskowa."
    }

    return $envValue
}

function Resolve-VendoConnection {
    $config = Get-VendoConfig

    return @{
        BaseUrl = Get-SettingValue -Value $config.BaseUrl -EnvName "VENDO_API_URL"
        ApiLogin = Get-SettingValue -Value $config.ApiLogin -EnvName "VENDO_API_LOGIN"
        ApiPassword = Get-SettingValue -Value $config.ApiPassword -EnvName "VENDO_API_PASSWORD"
        VendoUserLogin = Get-SettingValue -Value $config.VendoUserLogin -EnvName "VENDO_USER_LOGIN"
        VendoUserPassword = Get-SettingValue -Value $config.VendoUserPassword -EnvName "VENDO_USER_PASSWORD"
    }
}

function Invoke-VendoPost {
    param(
        [Parameter(Mandatory = $true)]
        [string] $BaseUrl,

        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [hashtable] $Payload
    )

    $uri = "{0}{1}" -f $BaseUrl.TrimEnd("/"), $Path
    $body = $Payload | ConvertTo-Json -Depth 10

    Write-Host "POST $uri" -ForegroundColor Cyan
    return Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json"
}

function Get-VendoAccessToken {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable] $Connection
    )

    $apiAuthResponse = Invoke-VendoPost -BaseUrl $Connection.BaseUrl -Path "/Autoryzacja/Zaloguj" -Payload @{
        Model = @{
            Login = $Connection.ApiLogin
            Haslo = $Connection.ApiPassword
        }
    }

    $apiToken = $apiAuthResponse.Wynik.Token
    if ([string]::IsNullOrWhiteSpace($apiToken)) {
        throw "Nie udalo sie uzyskac tokenu API."
    }

    Write-Host "Uzyskano token API." -ForegroundColor Green

    $vendoAuthResponse = Invoke-VendoPost -BaseUrl $Connection.BaseUrl -Path "/Autoryzacja/ZalogujUzytkownikaVendo" -Payload @{
        Token = $apiToken
        Model = @{
            Login = $Connection.VendoUserLogin
            Haslo = $Connection.VendoUserPassword
        }
    }

    $accessToken = $vendoAuthResponse.Wynik.Token
    if ([string]::IsNullOrWhiteSpace($accessToken)) {
        throw "Nie udalo sie uzyskac tokenu dostepowego uzytkownika Vendo."
    }

    Write-Host "Uzyskano token dostepowy uzytkownika Vendo." -ForegroundColor Green
    return $accessToken
}
