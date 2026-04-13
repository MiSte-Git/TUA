# Telegram User Activities

Desktop-Applikation zur Analyse der Mitgliederaktivität in Telegram-Gruppen und -Kanälen. Zeigt pro Mitglied Nachrichtenanzahl und Reaktionen; ermöglicht zusätzlich die gezielte Suche nach dem frühesten Nachweis eines bestimmten Benutzers im gesamten Chatverlauf.

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

Die Chat-URL-Eingabe ist **immer oben sichtbar** und wird von beiden Tabs gemeinsam genutzt. Darunter befinden sich zwei Tabs:

| Tab | Funktion |
|---|---|
| **Aktivitätsanalyse** | Nachrichten- und Reaktionsstatistik für alle Mitglieder im gewählten Zeitraum |
| **Erste Erwähnung** | Frühester Nachweis eines bestimmten Benutzers im gesamten Chatverlauf |

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

---

## Projektstruktur

```
.
├── src/                        # React-Frontend (TypeScript)
│   ├── components/
│   │   ├── LoginFlow.tsx       # Login-Wizard (Telefon, Code, Passwort)
│   │   ├── ChatUrlInput.tsx    # Geteilte Chat-URL-Eingabe mit History-Dropdown
│   │   ├── MainView.tsx        # Tab 1: Aktivitätsanalyse
│   │   ├── FirstMentionView.tsx # Tab 2: Erste Erwähnung
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
            ├── mention.rs      # Erste-Erwähnung-Suche
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

**WebKit-Fehler unter Linux**
→ Systembibliotheken fehlen. Den `apt`/`pacman`/`dnf`-Befehl oben ausführen.
