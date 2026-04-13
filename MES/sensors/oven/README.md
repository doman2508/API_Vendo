# Oven pulse counter

Monitoring impulsow z pieca.

## Cel

Zliczac kazdy przejazd PCB przez piec i wysylac zdarzenie do API MES.

## Aktualny setup

- ESP32
- czujnik optyczny `E18-D80NK`
- sygnal czujnika na `GPIO 4`
- zdarzenie wykrywane na zboczu `RISING`
- endpoint prototypowy FastAPI: `POST /pulse`
- endpoint docelowy w aplikacji: `POST /api/mes/oven/pulse`

## Dane

Nie zapisujemy licznika jako jednej zmiennej. Kazdy impuls zapisujemy jako osobne zdarzenie.

Przyklad:

```text
id | device_id | ts
1  | reflow_1  | 2026-04-12 10:01:12
2  | reflow_1  | 2026-04-12 10:01:18
3  | reflow_1  | 2026-04-12 10:01:25
```

Z tego mozna potem liczyc:
- sztuki w czasie,
- takt,
- przerwy,
- przeplyw przez piec,
- realny output wzgledem planu.

## Endpointy diagnostyczne

```http
GET /api/mes/oven/summary?device_id=reflow_1
GET /api/mes/oven/events?device_id=reflow_1&limit=50
```

## Partie KKW

Operator skanuje kod z karty KKW w widoku:

```text
/mes/operator
```

Na start wystarczy kod w formie:

```text
258/25
```

Skan startuje partie, a kolejne impulsy sa liczone dla aktywnego zakresu czasu tej partii.
