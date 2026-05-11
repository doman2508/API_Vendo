# MCP Produkcja Vendo/MES

Ten serwer MCP wystawia tylko dane produkcyjne:

- KKW i zlecenia produkcyjne,
- koszty i wykonanie KKW,
- aktywna produkcja z Vendo,
- wydajnosc, ryzyka, problemy i opoznienia,
- MES pieca/reflow z lokalnego SQLite.

Nie ma narzedzi zapisu. Nie wystawia administracji, sprzedazy ani ogolnego magazynu poza kontekstem produkcji.

## Wymagana konfiguracja

Serwer czyta konfiguracje z env albo z `start-local.ps1`:

```text
VENDO_API_URL
VENDO_API_LOGIN
VENDO_API_PASSWORD
VENDO_USER_LOGIN
VENDO_USER_PASSWORD
MES_SQLITE_DB_PATH
```

Opcjonalnie mozna ustawic token dla HTTP/SSE:

```text
MCP_BEARER_TOKEN
```

Jesli token jest ustawiony, klient musi wyslac naglowek:

```text
Authorization: Bearer <token>
```

Uwaga: ChatGPT Apps/Connectors dla chronionego MCP oczekuja OAuth 2.1. Prosty `MCP_BEARER_TOKEN` jest wygodny dla wlasnych klientow lub lokalnego debugowania, ale do szybkiego testu w ChatGPT uruchamiaj serwer z `--no-auth`.

## Uruchomienie HTTP/SSE

```powershell
node .\mcp-production-server.js --no-auth
```

Okno z tym procesem musi zostac otwarte. Zamkniecie terminala zatrzymuje serwer.

Domyslnie serwer slucha lokalnie:

```text
http://127.0.0.1:3020
```

Endpointy:

- `GET /health`
- `GET /sse`
- `POST /message?sessionId=...`
- `POST /mcp`

Do ChatGPT uzyj publicznego endpointu `https://.../mcp`. ChatGPT nie podlaczy sie bezposrednio do `localhost`, wiec do testow webowych wystaw lokalny port przez HTTPS, np. reverse proxy, Cloudflare Tunnel albo ngrok.

Przyklad po wystawieniu tunelu:

```text
Connector URL: https://twoj-tunel.example.com/mcp
```

Port i host mozna zmienic:

```powershell
$env:MCP_HOST = "127.0.0.1"
$env:MCP_PORT = "3020"
node .\mcp-production-server.js --no-auth
```

## Uruchomienie STDIO

Do lokalnych klientow MCP, ktore uruchamiaja proces:

```powershell
node .\mcp-production-server.js --stdio
```

Przykladowa konfiguracja klienta lokalnego:

```json
{
  "mcpServers": {
    "vendo-production": {
      "command": "node",
      "args": [
        "C:\\Users\\tomas\\Documents\\Projekty\\API_Vendo\\mcp-production-server.js",
        "--stdio"
      ]
    }
  }
}
```

## Narzedzia MCP

`search` i `fetch` sa przygotowane pod ChatGPT/konektory:

- `search` - wyszukuje w produkcji,
- `fetch` - pobiera konkretny wynik z `search`.

Dodatkowe narzedzia:

- `production_risk_report`
- `production_overview`
- `kkw_list`
- `kkw_details`
- `mes_oven_summary`
- `mes_oven_batches`
- `mes_oven_events`

## Przykladowe pytania

```text
Jakie sa teraz najwieksze ryzyka na produkcji?
```

```text
Pokaz KKW 150/26 i powiedz, gdzie mamy problem z kosztem albo wykonaniem.
```

```text
Czy piec reflow_1 pracuje stabilnie i jaki ma takt?
```
