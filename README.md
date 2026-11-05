# Gym Tracker

Persönlicher Gym Tracker als PWA (Web-App, die sich wie eine native App aufs iPhone installieren lässt).
Kein Framework, kein Build-Schritt, keine Kosten.

## Stack
- **Frontend:** reines HTML/CSS/JavaScript (`index.html`, `styles.css`, `app.js`)
- **Datenbank:** IndexedDB im Browser, also lokal auf dem iPhone (offline, privat, kostenlos)
- **Offline:** Service Worker (`sw.js`), App-Manifest (`manifest.webmanifest`)
- **Hosting (geplant):** GitHub Pages, kostenlos
- **Optional später:** Cloud-Sync über Supabase (Free Tier)

## Funktionen
- Training starten (frei, aus Plan oder als Wiederholung), Sätze mit kg × Wdh. abhaken, Cardio mit Minuten/km
- „Letztes Mal“-Anzeige und vorausgefüllte Werte, Pausentimer mit Ton
- Trainingspläne anlegen und bearbeiten
- Orte (Gyms) per GPS speichern und beim Start automatisch erkennen
- Statistik: Trainings pro Woche, Kraftverlauf (geschätztes 1RM), Max-Gewicht, Volumen, Muskelgruppen, Orte, Körpergewicht
- Gamification: XP, Level mit Titeln, Wochen-Streak (Wochenziel einstellbar), persönliche Rekorde, 15 Erfolge
- Backup als JSON exportieren/importieren

## Lokal testen (MacBook)
```bash
cd gym-tracker
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Aufs iPhone bringen (kostenlos)
1. Ordner in ein GitHub-Repo pushen, unter *Settings → Pages* den Branch `main` / Root aktivieren.
2. Die Pages-URL in **Safari** auf dem iPhone öffnen → Teilen → **Zum Home-Bildschirm**.
3. Nach Code-Änderungen in `sw.js` die `VERSION` erhöhen, damit das iPhone die neue Version lädt.

Die Daten bleiben auf dem iPhone. Ab und zu unter *Mehr → Backup exportieren* sichern (z. B. in iCloud Drive).
