# API_Vendo

Minimalny starter do pierwszych integracji z Vendo API.

## Frontend

Lokalna aplikacja webowa jest dostepna po uruchomieniu:

```powershell
node .\server.js
```

Potem otworz:

```text
http://localhost:3000/console
```

Frontend:

- zbiera login/haslo uzytkownika Vendo,
- zapisuje je lokalnie w przegladarce (tylko Vendo),
- wysyla zapytanie do lokalnego proxy,
- pokazuje liste towarow w tabeli i surowy JSON.

Dostepne widoki:

- `/console` - konsola API do pracy operacyjnej i testow,
- `/production-dashboard` - osobny modul dla produkcji oparty o ten sam backend.
- `/zapotrzebowanie` - modul zakupowy oparty o Access, WMS i Vendo, rozwijany docelowo jako niezalezna aplikacja.

## Dokumentacja

- `docs/kosztykkw.md`
- `docs/zapotrzebowanie-plan.md`

## Konfiguracja

Dane dostepowe sa trzymane w:

- `scripts/vendo-common.ps1`

Mozesz wpisac wartosci bezposrednio w pliku albo zostawic puste pola i korzystac ze zmiennych srodowiskowych:

- `VENDO_API_URL`
- `VENDO_API_LOGIN`
- `VENDO_API_PASSWORD`
- `VENDO_USER_LOGIN`
- `VENDO_USER_PASSWORD`
- `WMS_SQL_SERVER`
- `WMS_SQL_DATABASE`
- `WMS_SQL_USER`
- `WMS_SQL_PASSWORD`
- `ACCESS_BACKEND_PATH`
- `SQLITE_DB_PATH`

W **bezpiecznym wariancie** aplikacji webowej dane do API sa trzymane po stronie serwera w zmiennych:

- `VENDO_API_URL` (np. `http://192.168.1.10:8090`)
- `VENDO_API_LOGIN`
- `VENDO_API_PASSWORD`

Uzytkownik w przegladarce wpisuje tylko `Login Vendo` i `Haslo Vendo`.

## SQLite Dla Zapotrzebowania

Modul `Zapotrzebowanie` dostal fundament pod lokalna baze `SQLite`.

- lokalnie domyslna sciezka to `.data/zapotrzebowanie.db`
- docelowo plik `.db` i `server.js` powinny byc na tej samej maszynie
- plan migracji jest opisany w [docs/zapotrzebowanie-plan.md](docs/zapotrzebowanie-plan.md)

Dostepne endpointy techniczne:

- `GET /api/zapotrzebowanie/storage/meta`
- `POST /api/zapotrzebowanie/storage/import-access`
- `GET /api/zapotrzebowanie/operational/overview`
- `POST /api/zapotrzebowanie/operational/header-details`

## Uruchomienie

Pierwszy test polaczenia:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\first-request.ps1
```

Pobranie pierwszej listy towarow:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\get-products.ps1
```

Pobranie towaru o konkretnym kodzie:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\get-products.ps1 -ProductCode "T123"
```

Pelna surowa odpowiedz JSON:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\get-products.ps1 -Raw
```

## Co robia skrypty

`first-request.ps1`

- loguje sie do API,
- loguje uzytkownika Vendo,
- pobiera slownik `Waluty`.

`get-products.ps1`

- loguje sie do API,
- loguje uzytkownika Vendo,
- wywoluje `/Magazyn/Towary/Lista`,
- opcjonalnie filtruje po kodzie towaru,
- domyslnie pokazuje skrocona tabele,
- po `-Raw` zwraca pelny JSON.
