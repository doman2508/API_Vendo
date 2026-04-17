param(
    [Parameter(Mandatory = $true)]
    [string] $AccessPath
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

function Convert-RecordValue {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Value
    )

    if ($Value -is [System.DBNull]) {
        return $null
    }

    if ($Value -is [DateTime]) {
        return $Value.ToString("o")
    }

    return $Value
}

function Convert-DataTableToObjects {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.DataTable] $Table
    )

    $rows = @()
    foreach ($row in $Table.Rows) {
        $item = [ordered]@{}
        foreach ($column in $Table.Columns) {
            $item[$column.ColumnName] = Convert-RecordValue -Value $row[$column.ColumnName]
        }
        $rows += [PSCustomObject]$item
    }

    return $rows
}

function New-AccessOleDbConnection {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DatabasePath
    )

    $providers = @("Microsoft.ACE.OLEDB.16.0", "Microsoft.ACE.OLEDB.12.0")
    $errors = @()

    foreach ($provider in $providers) {
        $connection = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$DatabasePath;Persist Security Info=False;Mode=Read;")
        try {
            $connection.Open()
            return $connection
        } catch {
            $errors += "${provider}: $($_.Exception.Message)"
            $connection.Dispose()
        }
    }

    $details = $errors -join " | "
    throw [System.InvalidOperationException]::new("Nie udalo sie otworzyc bazy Access. Na tym komputerze brakuje zarejestrowanego providera ACE OLEDB 16.0/12.0 albo bitowosc providera nie pasuje do PowerShell/Node. Zainstaluj Microsoft Access Database Engine 2016 Redistributable x64 na serwerze albo uruchom aplikacje w zgodnej bitowosci. Szczegoly: $details")
}

function Invoke-AccessSelect {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DatabasePath,

        [Parameter(Mandatory = $true)]
        [string] $Sql
    )

    $connection = New-AccessOleDbConnection -DatabasePath $DatabasePath

    try {
        $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($Sql, $connection)
        $table = New-Object System.Data.DataTable
        [void]$adapter.Fill($table)
        return Convert-DataTableToObjects -Table $table
    } finally {
        $connection.Close()
    }
}

$createdByColumn = "utworzy$([char]322)"
$componentQtyColumn = "Ilo$([char]347)$([char]263)"

$headersSql = @"
SELECT
    zp.[Id] AS sourceAccessId,
    zp.[Id_kkw] AS sourcePlanPositionId,
    zp.[KKW] AS kkwNumber,
    zp.[Index] AS productIndex,
    zp.[Produkt] AS productName,
    zp.[ilosc] AS orderQty,
    zp.[Status] AS smdDone,
    zp.[THT] AS thtDone,
    zp.[Termin] AS termDate,
    zp.[Klient] AS clientName,
    zp.[Paczka] AS packetFlag,
    zp.[Zak] AS zakStatus,
    zp.[uwagi] AS notes,
    zp.[$createdByColumn] AS createdBy,
    zp.[data_utw] AS createdAt,
    Null AS smdDoneAt,
    Null AS thtDoneAt
FROM tbl_zakupy_produkt AS zp
ORDER BY zp.[Termin] ASC, zp.[Index] ASC, zp.[Id] ASC;
"@

$bomSql = @"
SELECT
    z.[Id_prod] AS sourceHeaderAccessId,
    z.[Id_material] AS sourceMaterialId,
    z.[Reference] AS parentReference,
    z.[Produkt] AS parentProductName,
    z.[Kod_komp] AS componentCode,
    z.[Komponent] AS componentName,
    z.[$componentQtyColumn] AS componentQty,
    z.[Stan_wymagany] AS requiredQty,
    z.[WMS_Stan] AS wmsStock,
    z.[WMS_zamowione] AS wmsOrdered,
    z.[Vendo_Stan] AS vendoStock,
    z.[Vendo_zamowione] AS vendoOrdered,
    z.[To_order] AS toOrder,
    z.[Uwagi_1] AS note1,
    z.[Uwagi_2] AS note2,
    z.[Uwagi_3] AS note3,
    z.[Rodzaj] AS typeName,
    z.[SMD] AS smdDone,
    z.[THT] AS thtDone,
    z.[WMS] AS wmsLabel,
    z.[Vendo] AS vendoLabel,
    z.[Add1] AS add1,
    z.[add2] AS add2,
    z.[add-txt1] AS addText1,
    z.[add-txt2] AS addText2,
    z.[add_int] AS addInt
FROM tbl_zakupy AS z
ORDER BY z.[Id_prod] ASC, z.[Kod_komp] ASC, z.[Komponent] ASC;
"@

$headers = Invoke-AccessSelect -DatabasePath $AccessPath -Sql $headersSql
$bomItems = Invoke-AccessSelect -DatabasePath $AccessPath -Sql $bomSql

[PSCustomObject]@{
    generatedAt = (Get-Date).ToString("o")
    accessPath = $AccessPath
    headerCount = @($headers).Count
    bomCount = @($bomItems).Count
    headers = @($headers)
    bomItems = @($bomItems)
} | ConvertTo-Json -Depth 8 -Compress
