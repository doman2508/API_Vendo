param(
    [string] $ProductCode = "",
    [int] $PageSize = 20,
    [switch] $Raw
)

. "$PSScriptRoot\vendo-common.ps1"

$connection = Resolve-VendoConnection
$accessToken = Get-VendoAccessToken -Connection $connection

$model = @{
    Cursor = $true
    CursorCzyZamknac = $false
    Strona = @{
        Indeks = 0
        LiczbaRekordow = $PageSize
    }
}

if (-not [string]::IsNullOrWhiteSpace($ProductCode)) {
    $model.FiltrUniwersalny = $ProductCode
    $model.FiltrUniwersalnyPola = @("Kod")
}

$productsResponse = Invoke-VendoPost -BaseUrl $connection.BaseUrl -Path "/Magazyn/Towary/Lista" -Payload @{
    Token = $accessToken
    Model = $model
}

Write-Host ""
Write-Host "Odpowiedz z /Magazyn/Towary/Lista:" -ForegroundColor Yellow

if ($Raw) {
    $productsResponse | ConvertTo-Json -Depth 10
    return
}

$records = @($productsResponse.Wynik.Rekordy)
$summary = $records | Select-Object ID, Kod, Nazwa, Rodzaj1, Aktywnosc, JednostkaKod

$summary | Format-Table -AutoSize

Write-Host ""
Write-Host ("Liczba zwroconych rekordow: {0}" -f $records.Count) -ForegroundColor Green
if ($productsResponse.Wynik.Cursor) {
    Write-Host ("Wszystkie rekordy wg kursora: {0}" -f $productsResponse.Wynik.Cursor.LiczbaWszystkichRekordow) -ForegroundColor Green
    Write-Host ("Nazwa kursora: {0}" -f $productsResponse.Wynik.Cursor.Nazwa) -ForegroundColor Green
}
