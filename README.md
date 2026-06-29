# Telegram User Activities

**Aktuelle Version:** 0.2.0

Desktop-Applikation zur Analyse der Mitgliederaktivität in Telegram-Gruppen und -Kanälen. Zeigt pro Mitglied Nachrichtenanzahl und Reaktionen; ermöglicht zusätzlich die gezielte Suche nach dem frühesten Nachweis eines bestimmten Benutzers sowie nach Ein- und Austrittsereignissen im Chatverlauf.

Gebaut mit **Tauri 2** (Rust-Backend) · **React 19 + TypeScript** (Frontend) · **Tailwind CSS 4** · **grammers** (MTProto-Client).

---

## Voraussetzungen

### System

| Werkzeug | Mindestversion | Installationshinweis |
|---|---|---|
| Rust & Cargo | 1.70 | [rustup.rs](https://rustup.rs) |
| Node.js | 18 | [nodejs.org](https://nodejs.org) |
| npm | 9 | kommt mit Node.js |

Auf **Linux** werden zusätzlich folgende Systembibliotheken benötigt (Tauri-Abhängigkeiten):

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
     libayatana-appindicator3-dev librsvg2-dev build-essential

# Arch Linux
sudo pacman -S webkit2gtk-4.1 openssl gtk3 librsvg base-devel

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel librsvg2-devel
```

Auf **macOS** und **Windows** sind keine zusätzlichen Systembibliotheken nötig.

### Telegram API-Zugangsdaten

Die App benötigt eigene API-Zugangsdaten von Telegram:

1. Auf [my.telegram.org](https://my.telegram.org) einloggen.
2. Unter **API development tools** eine neue Applikation anlegen.
3. `api_id` (Zahl) und `api_hash` (Zeichenkette) notieren.

---

## Installation & Kompilierung

### 1. Repository klonen

```bash
git clone <repo-url>
cd "Telegram User Activities"
```

### 2. Node-Abhängigkeiten installieren

```bash
npm install
```

### 3. Umgebungsvariablen setzen

Die API-Zugangsdaten müssen beim Bauen **und** beim Ausführen als Umgebungsvariablen verfügbar sein:

```bash
export TELEGRAM_API_ID=12345678
export TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
```

Für dauerhafte Einrichtung diese Zeilen in `~/.bashrc`, `~/.zshrc` o. Ä. eintragen.

### 4a. Entwicklungsmodus starten

Startet Frontend (Vite Dev Server) und Tauri-Fenster mit Hot-Reload:

```bash
npm run tauri dev
```

### 4b. Produktiv-Build erstellen

Erzeugt ein installationsfertiges Paket im Verzeichnis `src-tauri/target/release/bundle/`:

```bash
npm run tauri build
```

Ausgabe je nach Betriebssystem:

| Plattform | Paketformat | Pfad |
|---|---|---|
| Linux | `.deb`, `.rpm`, `AppImage` | `src-tauri/target/release/bundle/` |
| macOS | `.dmg`, `.app` | `src-tauri/target/release/bundle/` |
| Windows | `.msi`, `.exe` (NSIS) | `src-tauri\target\release\bundle\` |

Das erzeugte Paket kann auf dem Zielsystem wie gewohnt installiert werden (Doppelklick oder Paketverwaltung).

---

## Erste Verwendung

1. App starten.
2. Telefonnummer (mit Ländervorwahl, z. B. `+41791234567`) eingeben und **Verbinden** klicken.
3. Den von Telegram per SMS / Telegram-App zugesandten Code eingeben.
4. Bei Zwei-Faktor-Authentifizierung zusätzlich das Cloud-Passwort eingeben.
5. Die Telegram-Session wird lokal gespeichert; beim nächsten Start entfällt der Login.

**Session-Speicherort:**

| Plattform | Pfad |
|---|---|
| Linux | `~/.config/telegram_user_activities/` |
| macOS | `~/Library/Application Support/telegram_user_activities/` |
| Windows | `%APPDATA%\telegram_user_activities\` |

---

## Bedienung

### Layout

Die Chat-URL-Eingabe ist **immer oben sichtbar** und wird von allen Tabs gemeinsam genutzt. Darunter befinden sich drei Tabs:

| Tab | Funktion |
|---|---|
| **Aktivitätsanalyse** | Nachrichten- und Reaktionsstatistik für alle Mitglieder im gewählten Zeitraum |
| **Erste Erwähnung** | Frühester Nachweis eines bestimmten Benutzers im gesamten Chatverlauf |
| **Ein/Austritt** | Suche nach Telegram-Service-Messages für hinzugefügt, beigetreten, verlassen und entfernt |

### Tab „Aktivitätsanalyse"

| Schritt | Aktion |
|---|---|
| **Gruppe auflösen** | t.me-Link oder `@username` in der Chat-URL-Eingabe oben eingeben → **Verbinden** |
| **Analysezeitraum** | 1 – 24 Monate wählen |
| **Reaktionen** | Optional: Reaktionen mitzählen (dauert länger) |
| **Analyse starten** | Scannt alle Nachrichten im Zeitraum |
| **Schwellenwert** | Mindestnachrichten- und Reaktionszahl für „aktiv" festlegen |
| **Ausschließen** | Zeile anklicken, um Mitglied manuell aus der Zählung zu nehmen |
| **Exportieren** | Ergebnis als CSV-Datei speichern |

#### Spalten in der Ergebnistabelle

| Spalte | Beschreibung |
|---|---|
| Name / @username | Anzeigename und Benutzername |
| Nachrichten | Anzahl eigener Nachrichten im Zeitraum |
| Reaktionen | Anzahl gesetzter Reaktionen (nur bei aktivierter Option) |

#### CSV-Export

Der Export enthält einen Metadaten-Header (Kommentarzeilen mit `#`) sowie eine Datenzeile pro Mitglied mit den Feldern:

```
user_id, name, username, message_count, reaction_count, active, excluded
```

### Tab „Erste Erwähnung"

Sucht den **frühesten Nachweis** eines bestimmten Benutzers im Chat — unabhängig vom in Tab 1 gewählten Analysezeitraum. Der gesamte verfügbare Chatverlauf wird bis zum Anfang durchsucht.

| Schritt | Aktion |
|---|---|
| **Username eingeben** | `@username` oder `username` (das `@` wird automatisch entfernt) |
| **Suchen** | Durchsucht alle Nachrichten ohne Zeitraum-Limit |

**Ergebnis:**

| Feld | Beschreibung |
|---|---|
| Erste eigene Nachricht | Datum der ältesten Nachricht, die der User selbst geschrieben hat |
| Erste Erwähnung | Datum der ältesten Nachricht, in der jemand anderes `@username` erwähnt hat |
| Frühester Nachweis | Minimum aus beiden — der frühestmögliche Beleg für die Anwesenheit im Chat |
| Kontext | Textausschnitt (max. 200 Zeichen) der Erwähnungs-Nachricht |
| Zur Nachricht | Direktlink zur Nachricht in Telegram (öffnet im Browser) |

> **Hinweis:** Die Suche kann bei sehr großen Gruppen oder langen Verläufen mehrere Minuten dauern. Fortschritt ist im Log-Fenster am unteren Rand sichtbar.

### Tab „Ein/Austritt"

Sucht Ein- und Austrittsereignisse eines bestimmten Benutzers anhand von Telegram-Service-Messages. Es wird **keine Textsuche** nach sichtbaren Telegram-UI-Texten verwendet; ausgewertet werden Telegram-API-Aktionen wie Hinzufügen, Beitritt per Link/Anfrage, Verlassen und Entfernen.

| Schritt | Aktion |
|---|---|
| **Username oder Mitglied wählen** | `@username`, Username oder Anzeigename eingeben; vorhandene Mitglieder können per Autocomplete ausgewählt werden |
| **Ereignistyp wählen** | Filter für hinzugefügt, beigetreten, verlassen und entfernt setzen |
| **Datumsbereich optional setzen** | `Zurück bis Datum` begrenzt die Suche nach hinten; `Bis Datum` begrenzt nach vorne, leer bedeutet heute. Datumsformat: `TT.MM.JJJJ` |
| **Suchen** | Durchsucht den Admin-Log, falls verfügbar, und fällt sonst auf den Chatverlauf zurück |
| **Abbrechen** | Laufende Suche kann abgebrochen werden |

**Ergebnis:**

| Feld | Beschreibung |
|---|---|
| Ereignis | hinzugefügt, beigetreten, verlassen oder entfernt |
| Datum / Uhrzeit | Zeitpunkt des Ereignisses |
| Betroffener User | gefundener Benutzer inklusive ID/Username, soweit verfügbar |
| Ausführender Account/Bot | Account, der die Aktion ausgelöst hat, soweit Telegram dies liefert |
| Chat-ID / Message-ID | technische IDs aus Telegram |

**Log und Laufzeit:**

Die Suche zeigt Fortschritt im Log-Fenster. Im Chatverlauf werden nicht nur sichtbare menschliche Nachrichten gezählt, sondern Telegram-Historieneinträge. Darunter können auch importierte/archivierte Nachrichten, Medien, Bot-Nachrichten und Service-Messages fallen. Der Abschlusslog unterscheidet deshalb zwischen geprüften Historieneinträgen und tatsächlich gefundenen Service-Messages, z. B.:

`Ein-/Austritt-Suche abgeschlossen. 43956 Historieneinträge geprüft, davon 475 Service-Messages, 4 Treffer gefunden. Dauer: 7m 25s.`

> **Hinweis:** Große Archivierungs- oder Importblöcke können die Suche verlangsamen, ohne das Ergebnis zu verfälschen. Wenn das gesuchte Ereignis sicher nach einem bekannten Archivierungsblock liegt, kann `Zurück bis Datum` entsprechend enger gesetzt werden.

---

## Projektstruktur

```
.
├── src/                        # React-Frontend (TypeScript)
│   ├── components/
│   │   ├── LoginFlow.tsx       # Login-Wizard (Telefon, Code, Passwort)
│   │   ├── ChatUrlInput.tsx    # Geteilte Chat-URL-Eingabe mit History-Dropdown
│   │   ├── MainView.tsx        # Tab 1: Aktivitätsanalyse
│   │   ├── FirstMentionView.tsx # Tabs: Erste Erwähnung und Ein/Austritt
│   │   ├── Controls.tsx        # Analyse-Parameter und Export
│   │   ├── ResultsTable.tsx    # Ergebnistabelle (sortierbar)
│   │   ├── PeriodSelector.tsx  # Zeitraum-Auswahl
│   │   ├── LogWindow.tsx       # Live-Log während der Analyse
│   │   └── StatusBar.tsx       # Statuszeile
│   └── types/index.ts          # Gemeinsame TypeScript-Typen
│
└── src-tauri/                  # Rust-Backend (Tauri)
    └── src/
        ├── lib.rs              # Tauri-Commands (IPC-Brücke)
        └── telegram/
            ├── auth.rs         # Login-Flow, Session-Verwaltung
            ├── analysis.rs     # Nachrichtenanalyse (Aktivitätsanalyse)
            ├── mention.rs      # Erste-Erwähnung- und Ein-/Austritt-Suche
            └── export.rs       # CSV-Export
```

---

## Häufige Probleme

**`TELEGRAM_API_ID not set` beim Start**
→ Umgebungsvariablen sind nicht gesetzt. Vor dem Start exportieren oder in das Shell-Profil eintragen (siehe oben).

**Login-Loop / „Session ungültig"**
→ Session-Datei löschen (Pfad siehe oben) und neu einloggen.

**Analyse bricht nach wenigen Nachrichten ab**
→ Telegram drosselt API-Anfragen. Die App wartet automatisch; bei sehr großen Gruppen kann die Analyse mehrere Minuten dauern.

**„Erste Erwähnung"-Suche dauert sehr lange**
→ Die Suche durchläuft den gesamten Chatverlauf ohne Zeitraum-Limit. Bei Gruppen mit Hunderttausenden von Nachrichten ist eine Laufzeit von mehreren Minuten normal. Der Fortschritt ist im Log-Fenster sichtbar.

**„Ein/Austritt"-Suche prüft ungewöhnlich viele Historieneinträge**
→ Telegram liefert nicht nur sichtbare menschliche Nachrichten, sondern API-Historieneinträge. Archivierte oder importierte Nachrichten können große Blöcke erzeugen. Die Suche wertet daraus nur Telegram-Service-Messages als mögliche Treffer aus; der Abschlusslog zeigt, wie viele Service-Messages tatsächlich geprüft wurden.

**WebKit-Fehler unter Linux**
→ Systembibliotheken fehlen. Den `apt`/`pacman`/`dnf`-Befehl oben ausführen.
