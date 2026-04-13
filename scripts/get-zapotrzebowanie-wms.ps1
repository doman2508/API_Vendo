param(
    [Parameter(Mandatory = $true)]
    [string] $SqlServer,

    [Parameter(Mandatory = $true)]
    [string] $SqlDatabase,

    [Parameter(Mandatory = $true)]
    [string] $SqlUser,

    [Parameter(Mandatory = $true)]
    [string] $SqlPassword,

    [string] $Codes = ""
)

$ErrorActionPreference = "Stop"

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

$normalizedCodes = @()
$seenCodes = @{}

foreach ($rawCode in ($Codes -split "\|")) {
    $code = [string](Get-OrDefault -Value $rawCode -Default "")
    $trimmed = $code.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        continue
    }

    if (-not $seenCodes.ContainsKey($trimmed)) {
        $seenCodes[$trimmed] = $true
        $normalizedCodes += $trimmed
    }
}

if (-not $normalizedCodes.Count) {
    [PSCustomObject]@{
        generatedAt = (Get-Date).ToString("o")
        sqlServer = $SqlServer
        sqlDatabase = $SqlDatabase
        rowCount = 0
        rows = @()
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
}

$connectionString = "Server=$SqlServer;Database=$SqlDatabase;User ID=$SqlUser;Password=$SqlPassword;TrustServerCertificate=True;Encrypt=False;Connection Timeout=15;"
$connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
$connection.Open()

try {
    $command = $connection.CreateCommand()
    $parameterNames = @()

    for ($index = 0; $index -lt $normalizedCodes.Count; $index += 1) {
        $parameterName = "@code$index"
        $parameterNames += $parameterName
        $parameter = $command.Parameters.Add($parameterName, [System.Data.SqlDbType]::NVarChar, 128)
        $parameter.Value = $normalizedCodes[$index]
    }

    $command.CommandText = @"
SELECT
    m.Reference AS code,
    SUM(lu.Quantity) AS wmsStock
FROM dbo.LogisticUnits AS lu
INNER JOIN dbo.Materials AS m ON lu.Material = m.Id
WHERE m.Reference IN ($($parameterNames -join ", "))
GROUP BY m.Reference;
"@

    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)

    $wmsByCode = @{}
    foreach ($row in $table.Rows) {
        $code = [string](Get-OrDefault -Value $row["code"] -Default "")
        $trimmed = $code.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        $wmsByCode[$trimmed] = [double](Get-OrDefault -Value $row["wmsStock"] -Default 0)
    }

    $rows = foreach ($code in $normalizedCodes) {
        [PSCustomObject]@{
            code = $code
            wmsStock = [double](Get-OrDefault -Value $wmsByCode[$code] -Default 0)
        }
    }

    [PSCustomObject]@{
        generatedAt = (Get-Date).ToString("o")
        sqlServer = $SqlServer
        sqlDatabase = $SqlDatabase
        rowCount = @($rows).Count
        rows = @($rows)
    } | ConvertTo-Json -Depth 4 -Compress
} finally {
    $connection.Close()
}
