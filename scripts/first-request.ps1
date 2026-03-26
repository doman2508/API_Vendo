. "$PSScriptRoot\vendo-common.ps1"

$connection = Resolve-VendoConnection
$accessToken = Get-VendoAccessToken -Connection $connection

$dictionaryResponse = Invoke-VendoPost -BaseUrl $connection.BaseUrl -Path "/DB/Slowniki" -Payload @{
    Token = $accessToken
    Model = @{
        Nazwy = @("Waluty")
    }
}

Write-Host ""
Write-Host "Odpowiedz z /DB/Slowniki:" -ForegroundColor Yellow
$dictionaryResponse | ConvertTo-Json -Depth 10
