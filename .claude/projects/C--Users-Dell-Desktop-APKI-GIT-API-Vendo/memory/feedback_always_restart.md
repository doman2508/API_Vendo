---
name: always-restart-server
description: Always restart the node server after backend changes without asking
type: feedback
---

Zawsze restartuj serwer node po zmianach backendowych (server.js) bez pytania.

**Why:** Uzytkownik nie chce byc pytany za kazdym razem — jesli zmiana wymaga restartu, po prostu to zrob.
**How to apply:** Po edycji server.js ubij stary proces node i uruchom nowy w tle.
