$env:MCP_HOST = "127.0.0.1"
$env:MCP_PORT = "3020"
Set-Location -LiteralPath $PSScriptRoot

# ChatGPT developer-mode connector tests are easiest without custom Bearer auth.
# For a permanent public deployment, use OAuth 2.1 in front of the MCP server.
node .\mcp-production-server.js --no-auth
