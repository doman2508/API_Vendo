# Zapotrzebowanie: Plan Migracji Z Accessa

## Cel

Przeniesc aplikacje zakupowa z Accessa do naszego modulu webowego tak, aby:

- logika raportu nie zalezala od kwerend i formularzy Accessa,
- stany magazynowe byly liczone na zywo z `WMS` i `Vendo`,
- statusy robocze produktow i BOM-ow byly utrzymywane po naszej stronie,
- zakupowiec pracowal juz tylko w jednej aplikacji.

## Zasada Dzialania

Obecna aplikacja Access:

- zbiera produkty do realizacji,
- trzyma ich statusy (`SMD`, `THT`, otwarte / zamkniete pozycje),
- laczy to z BOM-em,
- pobiera stany z `WMS` i `Vendo`,
- na tej podstawie wylicza zapotrzebowanie dla zakupowca.

To jest dobra logika biznesowa i warto ja zachowac, ale nie warto dalej opierac jej o Access jako aplikacje.

## Docelowe Zrodla Prawdy

### 1. WMS

Z `WMS` bierzemy:

- stan magazynowy komponentow,
- ewentualnie dodatkowe informacje magazynowe potrzebne pozniej do filtrowania.

`WMS` pozostaje zrodlem prawdy dla fizycznego stanu magazynu.

### 2. Vendo

Z `Vendo` bierzemy:

- stan handlowy / dostepny,
- oczekiwane dostawy,
- KKW,
- ZLP / zlecenia produkcyjne,
- `Nr obcy`,
- powiazania typu `PozycjaZleceniaID`, `ZlecenieID`, `KKWID`.

`Vendo` pozostaje zrodlem prawdy dla obiegu produkcyjno-handlowego.

### 3. Nasza Baza

Po naszej stronie trzymamy:

- liste produktow branych do raportu,
- ich statusy robocze (`SMD`, `THT`, zamkniecie, uwagi),
- BOM do tych produktow,
- dodatkowe informacje zakupowe potrzebne tylko lokalnie.

To jest najwazniejszy krok migracji: Access ma przestac byc miejscem, w ktorym "zyje" logika statusow.

Na ten modul wybieramy `SQLite`, bo:

- struktura jest mala,
- rekordow nie ma duzo,
- wdrozenie jest prostsze niz przy `SQL Server`,
- lokalny start na komputerze developerskim jest szybki,
- pozniej mozemy przeniesc jednoczesnie aplikacje `Node` i plik `.db` na `192.168.1.10`.

Wazna zasada:

- plik `SQLite` ma lezec lokalnie na tej samej maszynie co `server.js`,
- nie chcemy pracowac na pliku `.db` wystawionym przez SMB jako wspoldzielony magazyn dla wielu klientow.

## Docelowy Model Danych

Najrozsadniej postawic to na `SQLite`, a nie na nowym Accessie albo plikach JSON:

- jedna baza w pliku,
- zero dodatkowej administracji,
- wystarczajaco dobra wydajnosc dla tego modulu,
- prostszy start lokalnie i prostsza migracja na serwer aplikacyjny.

### Tabela `zakupy_naglowki`

Jeden rekord = jeden produkt / pozycja planistyczna do obserwacji.

Przykladowe pola:

- `id`
- `source_access_id`
- `source_plan_position_id`
- `source_plan_order_id`
- `source_order_id`
- `source_kkw_id`
- `kkw_number`
- `zlp_number`
- `nr_obcy`
- `product_index`
- `product_name`
- `client_name`
- `order_qty`
- `term_date`
- `smd_done`
- `tht_done`
- `is_closed`
- `notes`
- `created_at`
- `updated_at`

### Tabela `zakupy_bom_pozycje`

Jeden rekord = jeden komponent w BOM-ie danego naglowka.

Przykladowe pola:

- `id`
- `header_id`
- `component_code`
- `component_name`
- `required_qty`
- `rodzaj`
- `line_smd_done`
- `line_tht_done`
- `notes`
- `created_at`
- `updated_at`

### Tabela `zakupy_audit`

Do historii zmian statusow i edycji.

Przykladowe pola:

- `id`
- `entity_type`
- `entity_id`
- `field_name`
- `old_value`
- `new_value`
- `changed_by`
- `changed_at`

## Logika Raportu

Raport `Zapotrzebowanie` powinien byc liczony po naszej stronie:

1. Bierzemy aktywne naglowki.
2. Bierzemy ich otwarte pozycje BOM.
3. Sumujemy zapotrzebowanie po `component_code`.
4. Dociagamy:
   - `WMS stock`
   - `Vendo stock`
   - `Vendo expected`
5. Liczymy bilans:
   - `toOrder = (wms + vendo + expected) - required`
6. Wartosc ujemna oznacza brak i pozycje do zakupu.

W drill-down pokazujemy:

- termin,
- KKW,
- ZLP,
- `Nr obcy`,
- produkt,
- klienta,
- ilosc produktu,
- potrzebe dla zlecenia,
- bilans przed i po.

## Jak Migrowac

### Etap 1. Stabilizacja raportu

To juz trwa.

Zakres:

- liczenie raportu po naszej stronie,
- integracja `Access + WMS + Vendo`,
- poprawne mapowanie `ZLP`, `Nr obcy`, `KKW`,
- debug lookupow.

Cel:

- miec poprawny raport zakupowy zanim ruszymy z formularzami.

### Etap 2. Wlasna baza po naszej stronie

Zakres:

- zakladamy nasze tabele w `SQLite`,
- robimy importer z `tbl_zakupy_produkt` i `tbl_zakupy`,
- przenosimy aktualne naglowki, BOM-y i statusy.

Cel:

- Access przestaje byc jedynym miejscem trzymania danych roboczych.

### Etap 3. Ekrany robocze

Zakres:

- lista naglowkow,
- dodawanie / edycja produktu,
- edycja BOM,
- oznaczanie `SMD` / `THT`,
- zamykanie pozycji,
- uwagi zakupowe.

Cel:

- uzytkownik robi codzienna prace juz w naszej aplikacji.

### Etap 4. Odciecie raportu od Accessa

Zakres:

- raport bierze naglowki i BOM tylko z naszej bazy,
- `WMS` i `Vendo` zostaja jako live integracje,
- Access zostaje co najwyzej jako archiwum lub import pomocniczy.

Cel:

- `Zapotrzebowanie` dziala bez Accessa.

### Etap 5. Wygaszenie Accessa

Zakres:

- wylaczenie codziennej pracy w Accessie,
- zostawienie tylko historii albo eksportu awaryjnego,
- domkniecie brakujacych ekranow w webie.

Cel:

- jedna aplikacja, jedno miejsce pracy, mniej recznych obejsc.

## Rekomendacja

Nie przepisywac Accessa 1:1 ekran po ekranie.

Lepiej:

- zachowac logike biznesowa,
- uproscic model danych,
- przeniesc statusy do naszej bazy,
- zostawic `WMS` i `Vendo` jako integracje live,
- budowac ekranami od najbardziej krytycznych dla zakupowca.

## Najblizszy Krok

Najrozsadniejszy kolejny krok:

1. zaprojektowac finalne tabele `SQLite`,
2. zrobic import z `tbl_zakupy_produkt` i `tbl_zakupy`,
3. przygotowac nowy widok `Lista produktow / naglowkow`,
4. dopiero potem odcinac raport od Accessa.

To pozwoli migrowac etapami bez zatrzymania pracy zakupow.
