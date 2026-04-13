# MES

Modul MES zbiera rzeczywiste zdarzenia z hali i docelowo zasila `Production Dashboard`.

Pierwszy przypadek uzycia:
- stanowisko: piec / reflow
- zrodlo danych: czujnik optyczny + ESP32
- zdarzenie: pojedynczy przejazd PCB przez piec
- zapis: event log, czyli jeden rekord na jeden impuls
- powiazanie z partia: nowe impulsy dostaja `batch_id` aktywnej partii dla danego pieca

## Przeplyw danych

```text
PCB -> czujnik -> ESP32 -> WiFi -> API MES -> baza danych -> Production Dashboard
```

## Aktualny prototyp

Dzialajacy prototyp z `C:\Users\tomas\Desktop\main.py` zostal przeniesiony do:

```text
MES/api/main.py
```

Uruchomienie prototypu FastAPI:

```powershell
cd MES\api
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Endpoint:

```http
POST /pulse
```

Docelowy endpoint w glownym backendzie Node:

```http
POST /api/mes/oven/pulse
GET /api/mes/oven/summary?device_id=reflow_1
GET /api/mes/oven/events?device_id=reflow_1&limit=50
POST /api/mes/oven/batch/start
POST /api/mes/oven/batch/end
GET /api/mes/oven/batch/active?device_id=reflow_1
GET /api/mes/oven/batch/history?device_id=reflow_1
```

Nowe impulsy sa przypisywane bezposrednio do aktywnej partii MES przez `batch_id`. Starsze impulsy bez `batch_id` sa nadal liczone awaryjnie po zakresie czasu partii.

Jesli to samo KKW wraca na piec kilka razy, wykonanie jest sumowane po `device_id` + `kkw_number` ze wszystkich partii tego KKW. Pole `batchPulseCount` pokazuje tylko bieżące podejscie, a `pulseCount` / `kkwPulseCount` pokazuje laczna ilosc dla KKW.

Domyslny plik SQLite:

```text
.data/mes.db
```

Automatyczne pobieranie planowanej ilosci z KKW wymaga konfiguracji uzytkownika Vendo po stronie backendu:

```text
VENDO_USER_LOGIN
VENDO_USER_PASSWORD
```

Przykladowy payload:

```json
{
  "device_id": "reflow_1"
}
```

## Docelowo

Ten modul powinien zostac podpiety do glownego backendu i dashboardu jako specjalne stanowisko online, np. `PIEC-01` / `REFLOW-01`.

Planowane metryki:
- ostatni impuls,
- liczba impulsow w ostatnich 5 / 15 / 60 minutach,
- takt,
- status przeplywu,
- wykrywanie postoju,
- powiazanie z aktywna praca z Vendo.

## Widoki

```text
/mes
/mes/operator
```
