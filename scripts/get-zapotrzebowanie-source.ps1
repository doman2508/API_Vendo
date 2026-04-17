param(
    [Parameter(Mandatory = $true)]
    [string] $AccessPath,

    [Parameter(Mandatory = $true)]
    [string] $SqlServer,

    [Parameter(Mandatory = $true)]
    [string] $SqlDatabase,

    [Parameter(Mandatory = $true)]
    [string] $SqlUser,

    [Parameter(Mandatory = $true)]
    [string] $SqlPassword,

    [string] $RodzajFilter = "PCB"
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

    return $Value
}

function Get-OrDefault {
    param(
        [Parameter(Mandatory = $false)]
        [object] $Value,

        [Parameter(Mandatory = $true)]
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
        "ALL" {
            return @"
NOT (
       (((z.Rodzaj='SMD') OR (z.Rodzaj='PCB') OR (z.Rodzaj Like 'P*FABRYKAT')) AND zp.Status=True)
    OR ((z.Rodzaj='THT') AND zp.THT=True)
)
"@
        }
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
        Default {
            $escaped = $Filter.Replace("'", "''")
            return "(z.Rodzaj='" + $escaped + "')"
        }
    }
}

function Invoke-AccessQuery {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DatabasePath,

        [Parameter(Mandatory = $true)]
        [string] $Filter
    )

    $whereClause = Get-AccessWhereClause -Filter $Filter
    $sql = @"
SELECT
    z.Kod_komp AS code,
    z.Komponent AS component,
    Sum(z.Stan_wymagany) AS requiredQty,
    z.Rodzaj AS rodzaj,
    0 AS status
FROM tbl_zakupy AS z
INNER JOIN tbl_zakupy_produkt AS zp ON z.Id_prod = zp.Id
WHERE $whereClause
GROUP BY z.Kod_komp, z.Komponent, z.Rodzaj
ORDER BY Sum(z.Stan_wymagany) DESC, z.Kod_komp;
"@

    $connection = New-AccessOleDbConnection -DatabasePath $DatabasePath

    try {
        $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($sql, $connection)
        $table = New-Object System.Data.DataTable
        [void]$adapter.Fill($table)
        return Convert-DataTableToObjects -Table $table
    } finally {
        $connection.Close()
    }
}

function Invoke-WmsQuery {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Server,

        [Parameter(Mandatory = $true)]
        [string] $Database,

        [Parameter(Mandatory = $true)]
        [string] $User,

        [Parameter(Mandatory = $true)]
        [string] $Password
    )

    $connectionString = "Server=$Server;Database=$Database;User ID=$User;Password=$Password;TrustServerCertificate=True;Encrypt=False;Connection Timeout=15;"
    $sql = @"
SELECT
    m.Reference AS code,
    Sum(lu.Quantity) AS wmsStock
FROM dbo.LogisticUnits AS lu
INNER JOIN dbo.Materials AS m ON lu.Material = m.Id
GROUP BY m.Reference;
"@

    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    $connection.Open()

    try {
        $command = $connection.CreateCommand()
        $command.CommandText = $sql
        $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
        $table = New-Object System.Data.DataTable
        [void]$adapter.Fill($table)
        return Convert-DataTableToObjects -Table $table
    } finally {
        $connection.Close()
    }
}

$accessRows = Invoke-AccessQuery -DatabasePath $AccessPath -Filter $RodzajFilter
$wmsRows = Invoke-WmsQuery -Server $SqlServer -Database $SqlDatabase -User $SqlUser -Password $SqlPassword

$wmsByCode = @{}
foreach ($row in $wmsRows) {
    $code = [string]$row.code
    if ([string]::IsNullOrWhiteSpace($code)) {
        continue
    }

    $wmsByCode[$code.Trim()] = [double](Get-OrDefault -Value $row.wmsStock -Default 0)
}

$rows = foreach ($row in $accessRows) {
    $code = [string](Get-OrDefault -Value $row.code -Default "")
    $normalizedCode = $code.Trim()

    [PSCustomObject]@{
        code = $normalizedCode
        component = [string](Get-OrDefault -Value $row.component -Default "")
        requiredQty = [double](Get-OrDefault -Value $row.requiredQty -Default 0)
        rodzaj = [string](Get-OrDefault -Value $row.rodzaj -Default "")
        status = [int](Get-OrDefault -Value $row.status -Default 0)
        wmsStock = [double](Get-OrDefault -Value $wmsByCode[$normalizedCode] -Default 0)
    }
}

[PSCustomObject]@{
    generatedAt = (Get-Date).ToString("o")
    accessPath = $AccessPath
    sqlServer = $SqlServer
    sqlDatabase = $SqlDatabase
    rodzajFilter = $RodzajFilter
    rowCount = @($rows).Count
    rows = @($rows)
} | ConvertTo-Json -Depth 6 -Compress
