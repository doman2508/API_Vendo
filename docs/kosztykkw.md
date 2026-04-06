# Widok Koszty KKW

Widok dostepny pod adresem `/kosztykkw`. Sluzy do analizy kosztow pojedynczego KKW (Karty Kalkulacyjnej Wyrobu) z systemu Vendo.

## Struktura plików

| Plik | Rola |
|------|------|
| `public/kosztykkw/index.html` | HTML widoku |
| `public/kosztykkw/kosztykkw.css` | Dedykowany arkusz stylow |
| `public/kosztykkw-app.js` | Logika frontendowa (standalone, nie importuje app.js) |
| `server.js` | Backend — endpointy `/api/kkw-costs` i `/api/kkw-list` |

## Layout

Widok uzywa dwupanelowego gridu CSS (`main-grid`):

- **Lewy panel** — formularz wyszukiwania KKW, karty podsumowania, tabele danych
- **Prawy panel** — formularz polaczenia z Vendo + przegladarka KKW

Na ekranach < 860px layout przechodzi w jedna kolumne.

### Nawigacja

Gorny pasek z zakladkami: `Konsola API` | **Koszty KKW** | `Produkcja`

### Pasek kontekstowy

Pod nawigacja — wyswietla informacje o zrodle danych i badge statusu (Gotowe / Pobieranie / Sukces / Blad).

---

## Prawy panel

### Formularz polaczenia

Pola `Login Vendo` i `Haslo Vendo`. Dane zapisywane w `localStorage` pod kluczem `vendo-api-console` (wspolny z konsola API — mozna przechodzic miedzy widokami bez ponownego logowania).

Przyciski: **Zapamietaj** (zapisuje do localStorage), **Wyczysc** (resetuje formularz i localStorage).

### Przegladarka KKW

Panel z lista KKW do szybkiego przegladania.

- **Pole wyszukiwania** — szuka po: numerze KKW, nazwie towaru, kodzie towaru, nazwie pozycji zlecenia, numerze zlecenia, nazwie klienta zlecenia (`ZlecenieKontrahentNazwa`)
- **Przycisk "Zaladuj"** — pobiera liste KKW z serwera (Enter w polu wyszukiwania rowniez uruchamia wyszukiwanie)
- **Lista** — kazdy element wyswietla: numer KKW (monospace, bold), ilosc sztuk, termin, nazwe towaru
- **Paginacja** — przycisk "Wiecej..." laduje kolejne strony (50 rekordow na strone, najnowsze na gorze)
- **Klikniecie elementu** — wpisuje numer do formularza i automatycznie odpala pobieranie kosztow

#### Endpoint: `POST /api/kkw-list`

Payload:

```json
{
  "vendoUserLogin": "...",
  "vendoUserPassword": "...",
  "page": 0,
  "search": "tekst wyszukiwania"
}
```

Odpowiedz:

```json
{
  "Rekordy": [
    {
      "ID": 123,
      "Numer": "150/26",
      "TowarNazwa": "Nazwa produktu",
      "TowarKod": "KOD",
      "IloscOczekiwana": 100,
      "IloscWykonana": 95,
      "TerminZakonczeniaKKW": "2026-04-30",
      "ZlecenieNumer": "ZLP/001/26",
      "PozycjaZleceniaNazwa": "..."
    }
  ],
  "Strona": 0,
  "LiczbaRekordow": 50,
  "Razem": 230,
  "WiecejStron": true
}
```

Wewnetrznie uzywa kursora API Vendo do paginacji od konca (najnowsze rekordy pierwsze). Jesli kursor nie jest dostepny, pobiera do 200 rekordow i sortuje po ID malejaco.

Przeszukiwane pola (`FiltrUniwersalnyPola`):

- `Numer` — numer KKW
- `TowarNazwa` — nazwa towaru/produktu
- `TowarKod` — kod towaru
- `PozycjaZleceniaNazwa` — nazwa pozycji zlecenia
- `ZlecenieNumer` — numer zlecenia produkcyjnego
- `ZlecenieKontrahentNazwa` — nazwa klienta ze zlecenia

---

## Lewy panel

### Formularz wyszukiwania

Pole tekstowe na numer KKW (np. `119/25`) i przycisk **Pobierz koszty**. Obsluguje jeden numer na raz. Klikniecie KKW w przegladarce po prawej automatycznie wypelnia pole i uruchamia formularz.

### Karty podsumowania (Summary Cards)

Po pobraniu danych wyswietlaja sie 4 grupy kart:

#### 1. Identyfikacja (szare tlo)

| Karta | Zrodlo |
|-------|--------|
| Numer KKW | `Wynik.KkwNumer` |
| Produkt | `TowarKod - TowarNazwa` |
| Ilosc KKW | `Wynik.Ilosc` |
| Termin | `Wynik.TerminRealizacji` (z `TerminZakonczeniaKKW`) |
| Klient | Nazwa klienta z dokumentu ZO (lub pierwszego dokumentu) |

#### 2. Koszty globalne (zielone tlo)

| Karta | Opis |
|-------|------|
| Koszt calkowity | Materialy + Operacje wg stawek + Koszty dodatkowe |
| Materialy po realizacji | `MaterialyPostWartosc` |
| Operacje wg stawek | `OperacjeWgNowychStawek` (przeliczone wg wlasnych stawek RBH) |
| Koszt materialow z materialowki | Z kalkulacji lub realizacji |
| Koszty dodatkowe | Pojawia sie jesli > 0 |

#### 3. Koszt na sztuke (niebieskie tlo)

| Karta | Opis |
|-------|------|
| RAZEM | Koszt/Cena sprzedazy (marza %). Cena z FV, fallback na ZO z etykieta NIEZAFAKTUROWANE |
| Materialy | Materialy na sztuke |
| Montaz | Operacje wg stawek na sztuke |
| Koszty dodatkowe | Edytowalne pole `<input>` — po zmianie przelicza karty na zywo |

#### 4. Struktura raportu (zolte tlo)

Pozycje materialowki, liczba galezi, liczba lisci.

### Analiza rentownosci

Karta RAZEM w sekcji "Koszt na sztuke" zawiera analize rentownosci:

- Porownuje koszt na sztuke z cena sprzedazy
- **Priorytet ceny**: szuka produktu (`TowarKod`) w pozycjach FV → jesli nie ma, szuka w ZO
- Jesli cena pochodzi z ZO (nie wystawiono FV), wyswietla czerwona etykiete **NIEZAFAKTUROWANE**
- Wyswietla marze procentowa (zielona jesli dodatnia, czerwona jesli ujemna)

### Tabela: Operacje (wg nowych stawek)

Kolumny: Nazwa operacji | Rbh | Rbh (norma) | Stawka | Koszt wg stawki

- Operacje jednorazowe sa przekresone i przyciszone (opacity 0.45)
- Stawki operacji sa zdefiniowane w serwerze w obiekcie `STAWKI_OPERACJI`
- Operacje jednorazowe zdefiniowane w zbiorze `OPERACJE_JEDNORAZOWE`

### Sekcja: Materialy (domyslnie rozwinieta, zwijalna)

Kolumny: Kod | Nazwa | Ilosc | Uzyto (roznica) | Cena | Koszt

- Kazda kolumna jest sortowalna (klikniecie naglowka)
- Wskazniki sortowania (strzalki) w naglowkach

### Sekcja: Szczegoly raportu (domyslnie zwinieta)

Tabela "Galezie raportu" — 3 wiersze (Cale KKW, Materialy, Operacje) z kolumnami: Przed | Technologia | Norma/wejscie | Po realizacji.

### Sekcja: Dokumenty zlecenia (domyslnie rozwinieta, zwijalna)

Informacja o ZLP (numer, ID, liczba dokumentow).

Tabela dokumentow: Typ | Numer | Numer obcy | Data | Klient | Netto | Brutto | Stan

- Typy dokumentow: **ZO** (niebieskie, bold), **FV** (zielone, bold), RW, PW, WZ i inne
- Klikniecie wiersza z pozycjami (oznaczone `▸`) rozwija podtabele z pozycjami dokumentu
- Kolumna Brutto widoczna tylko dla FV

### Sekcja: Surowa odpowiedz JSON (domyslnie zwinieta)

Pelny JSON odpowiedzi z serwera do debugowania.

---

## Endpoint: `POST /api/kkw-costs`

Glowny endpoint pobierajacy koszty KKW. Agreguje dane z wielu endpointow Vendo.

### Payload

```json
{
  "vendoUserLogin": "...",
  "vendoUserPassword": "...",
  "kkwNumbers": "150/26"
}
```

### Przebieg

1. **Resolve KKW** — szuka rekordu KKW po numerze (`/Produkcja/KKW/Lista`)
2. **Materialowka** — `POST /Produkcja/KKW/MaterialowkaLista` (do 500 pozycji)
3. **Szacowanie kosztow** — `POST /Produkcja/KKW/SzacowanieKosztow`
4. **Raport PreTechInPost** — `POST /Produkcja/KKW/RaportPreTechInPost` (z `CzyUzycCenKalkulacyjnych: true`)
5. **Pracownicy/Wykonania** — `POST /Produkcja/KKW/PracownicyWykonanLista` (Rbh na operacje)
6. **Dokumenty zlecenia** — `POST /Dokumenty/Dokumenty/Lista` (po `ZleceniaID`)
7. **Odkrywanie FV** — jesli FV nie jest bezposrednio powiazana z ZLP, szuka lancuchem: ZO → Skojarzone → WZ → Skojarzone → FV

### Przeliczanie kosztow operacji wg wlasnych stawek

Serwer posiada tablice `STAWKI_OPERACJI` z wlasnymi stawkami za RBH per operacja. Koszty operacji sa przeliczane na podstawie:

- `Rbh` z wykonan pracownikow (`PracownicyWykonanLista`)
- Stawka z `STAWKI_OPERACJI` (dopasowanie po nazwie, case-insensitive, z dopasowaniem czesciowym przez `includes`)
- Operacje jednorazowe (`OPERACJE_JEDNORAZOWE`) sa wykluczone z sumy kosztow

### Odpowiedz (uproszczona)

```json
{
  "Wynik": {
    "KkwID": 123,
    "KkwNumer": "150/26",
    "ZlecenieID": 456,
    "ZlecenieNumer": "ZLP/001/26",
    "TowarKod": "PROD-001",
    "TowarNazwa": "Nazwa produktu",
    "TerminRealizacji": "2026-04-30",
    "Ilosc": 100,
    "Raport": { "Korzen": {}, "Galezie": [], "Liscie": [], "Materialy": {}, "Operacje": {} },
    "Materialowka": { "LiczbaPozycji": 15, "Pozycje": [] },
    "Podsumowanie": {
      "KorzenPostWartosc": 5000,
      "MaterialyPostWartosc": 3000,
      "OperacjePostWartosc": 2000,
      "KosztNaSztuke": 50,
      "MaterialyNaSztuke": 30,
      "OperacjeNaSztuke": 20,
      "OperacjeWgNowychStawek": 1800,
      "OperacjeWgNowychStawekNaSztuke": 18
    },
    "KosztyOperacjiWgStawek": {},
    "SumaKosztowOperacjiWgStawek": 1800,
    "SzacowanieKosztow": {},
    "DokumentyZlecenia": { "ZO": [], "FV": [], "Inne": [], "Wszystkie": [] }
  }
}
```

---

## Dane logowania

Dane Vendo sa przechowywane w `localStorage` pod kluczem `vendo-api-console`. Ten sam klucz jest wspoldzielony z widokiem `/console`, wiec zmiana w jednym widoku automatycznie dziala w drugim.

Serwer wymaga rowniez konfiguracji po stronie serwera (zmienne srodowiskowe lub `.env`):
- `VENDO_API_URL` — adres bazowy API Vendo
- `VENDO_API_LOGIN` — login API
- `VENDO_API_PASSWORD` — haslo API
