param(
    [Parameter(Mandatory = $true)]
    [string] $AccessPath,

    [Parameter(Mandatory = $true)]
    [string] $ComponentCode,

    [string] $Rodzaj = ""
)

$ErrorActionPreference = "Stop"

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

function Get-OrDefault {
    param(
        [Parameter(Mandatory = $false)]
        [object] $Value,

        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [object] $Default
    )

    if ($null -eq $Value -or $Value -is [System.DBNull]) {
        return $Default
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

function Get-AccessWhereClause {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Filter
    )

    $normalized = (Get-OrDefault -Value $Filter -Default "").Trim().ToUpperInvariant()
    switch ($normalized) {
        "SMD" {
            return "(z.Rodzaj='SMD' AND zp.Status=False)"
        }
        "PCB" {
            return "(z.Rodzaj='PCB' AND zp.Status=False)"
        }
        "THT" {
            return "(z.Rodzaj='THT' AND zp.THT=False)"
        }
        "POLFABRYKAT" {
            return "(z.Rodzaj Like 'P*FABRYKAT' AND zp.Status=False)"
        }
        "ALL" {
            return @"
NOT (
       (((z.Rodzaj='SMD') OR (z.Rodzaj='PCB') OR (z.Rodzaj Like 'P*FABRYKAT')) AND zp.Status=True)
    OR ((z.Rodzaj='THT') AND zp.THT=True)
)
"@
        }
        Default {
            return @"
NOT (
       (((z.Rodzaj='SMD') OR (z.Rodzaj='PCB') OR (z.Rodzaj Like 'P*FABRYKAT')) AND zp.Status=True)
    OR ((z.Rodzaj='THT') AND zp.THT=True)
)
"@
        }
    }
}

function Invoke-AccessQuery {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DatabasePath,

        [Parameter(Mandatory = $true)]
        [string] $Code,

        [Parameter(Mandatory = $true)]
        [string] $Filter
    )

    $whereClause = Get-AccessWhereClause -Filter $Filter
    $sql = @"
SELECT
    zp.Id AS headerId,
    zp.Id_kkw AS planRefId,
    zp.[Index] AS productIndex,
    zp.Produkt AS productName,
    zp.ilosc AS orderQty,
    zp.Status AS smdDone,
    zp.THT AS thtDone,
    zp.Termin AS termDate,
    zp.Klient AS clientName,
    zp.KKW AS kkwNumber,
    First(z.Komponent) AS component,
    First(z.Rodzaj) AS rodzaj,
    Sum(z.Stan_wymagany) AS requiredQty
FROM tbl_zakupy_produkt AS zp
INNER JOIN tbl_zakupy AS z ON z.Id_prod = zp.Id
WHERE z.Kod_komp = ?
  AND $whereClause
GROUP BY
    zp.Id,
    zp.Id_kkw,
    zp.[Index],
    zp.Produkt,
    zp.ilosc,
    zp.Status,
    zp.THT,
    zp.Termin,
    zp.Klient,
    zp.KKW
ORDER BY zp.Termin ASC, zp.[Index] ASC, zp.Id ASC;
"@

    $connection = New-AccessOleDbConnection -DatabasePath $DatabasePath

    try {
        $command = $connection.CreateCommand()
        $command.CommandText = $sql
        [void]$command.Parameters.AddWithValue("@code", $Code)
        $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($command)
        $table = New-Object System.Data.DataTable
        [void]$adapter.Fill($table)
        return Convert-DataTableToObjects -Table $table
    } finally {
        $connection.Close()
    }
}

$detailRows = Invoke-AccessQuery -DatabasePath $AccessPath -Code $ComponentCode -Filter $Rodzaj

$rows = foreach ($row in $detailRows) {
    [PSCustomObject]@{
        headerId = [int](Get-OrDefault -Value $row.headerId -Default 0)
        planRefId = [int](Get-OrDefault -Value $row.planRefId -Default 0)
        productIndex = [string](Get-OrDefault -Value $row.productIndex -Default "")
        productName = [string](Get-OrDefault -Value $row.productName -Default "")
        orderQty = [double](Get-OrDefault -Value $row.orderQty -Default 0)
        smdDone = [bool](Get-OrDefault -Value $row.smdDone -Default $false)
        thtDone = [bool](Get-OrDefault -Value $row.thtDone -Default $false)
        termDate = Get-OrDefault -Value $row.termDate -Default $null
        clientName = [string](Get-OrDefault -Value $row.clientName -Default "")
        kkwNumber = [string](Get-OrDefault -Value $row.kkwNumber -Default "")
        component = [string](Get-OrDefault -Value $row.component -Default "")
        rodzaj = [string](Get-OrDefault -Value $row.rodzaj -Default "")
        requiredQty = [double](Get-OrDefault -Value $row.requiredQty -Default 0)
    }
}

[PSCustomObject]@{
    generatedAt = (Get-Date).ToString("o")
    accessPath = $AccessPath
    componentCode = $ComponentCode
    rodzajFilter = $Rodzaj
    rowCount = @($rows).Count
    rows = @($rows)
} | ConvertTo-Json -Depth 6 -Compress
