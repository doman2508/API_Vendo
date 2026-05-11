@echo off
set MCP_HOST=127.0.0.1
set MCP_PORT=3020
cd /d "%~dp0"
node .\mcp-production-server.js --no-auth
