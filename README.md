# Telegram User Activities

**Aktuelle Version:** 1.0.2

Desktop-Applikation zur Analyse der Mitgliederaktivität in Telegram-Gruppen und -Kanälen. Zeigt pro Mitglied Nachrichtenanzahl und Reaktionen; ermöglicht zusätzlich die gezielte Suche nach dem frühesten Nachweis eines bestimmten Benutzers sowie nach Ein- und Austrittsereignissen im Chatverlauf.

Gebaut mit **Tauri 2** (Rust-Backend) · **React 19 + TypeScript** (Frontend) · **Tailwind CSS 4** · **grammers** (MTProto-Client).

---

Es gibt zwei Wege, Telegram User Activities zu benutzen – such dir den passenden aus:

- **[Für alle anderen](#für-alle-anderen-fertiger-installer)** – fertiger
  Installer von der Releases-Seite, keine Kommandozeile, kein Rust/Node
  nötig.
- **[Für Entwickler:innen](#für-entwicklerinnen)** – Quellcode klonen,
  Abhängigkeiten selbst installieren, direkt aus dem Repository heraus
  bauen/starten.

Beide Wege installieren am Ende exakt dasselbe Programm.

## Telegram API-Zugangsdaten

Unabhängig vom gewählten Weg braucht die App eigene API-Zugangsdaten von
Telegram (kostenlos, jede/r mit Telegram-Konto kann sie anlegen):

1. Auf [my.telegram.org](https://my.telegram.org) mit der eigenen
   Telefonnummer einloggen.
2. Unter **API development tools** eine neue Applikation anlegen (Name und
   Kurzname sind frei wählbar, z. B. "TUA").
3. `api_id` (Zahl) und `api_hash` (Zeichenkette) notieren.

Die App fragt beim ersten Start selbst danach (mit Schritt-für-Schritt-Anleitung
und direktem Link zu my.telegram.org) und speichert die Eingabe lokal – ein
Aufschreiben ist nur zur Sicherheit sinnvoll, falls die Konfiguration später
mal neu eingegeben werden muss.

### Warum jede/r eigene Zugangsdaten braucht

**Wofür die Daten da sind:** Die App meldet sich wie ein eigener Telegram-Client mit dem
Konto der Nutzerin bzw. des Nutzers an. Nur so kann sie den Chatverlauf, Reaktionen und
Umfragestimmen rückwirkend lesen. Telegram verlangt von jedem solchen Client eine
`api_id` und einen `api_hash`. Diese kennzeichnen **die App**, nicht eine Entwicklerin oder
einen Entwickler. Trotz des Namens „API development tools“ muss man nichts programmieren,
um sie anzulegen.

**Warum kein Bot?** Bots sehen keinen alten Verlauf, nur Nachrichten ab dem Zeitpunkt,
an dem sie im Chat sind, und auch das nur mit passenden Rechten. Für eine Auswertung
vergangener Monate reicht das nicht.

**Alternative: Zugangsdaten fest einbauen.** Technisch könnten Zugangsdaten beim Bauen
fest in die App eingebaut werden (so machen es viele Telegram-Apps). Dann entfiele der
Schritt auf my.telegram.org für alle Nutzer. Das wurde bewusst **nicht** gemacht, weil
dann alle Installationen dieselbe `api_id` teilen:

| Möglicher Fall | Wen es trifft | Folge |
|---|---|---|
| Wartezeit wegen zu vieler Abfragen (`FLOOD_WAIT`) | nur das Konto, das gerade abfragt | Sekunden bis Stunden warten, geht von selbst weg. Tritt unabhängig davon auf, wessen Zugangsdaten verwendet werden. |
| Sperre der `api_id` (z. B. `API_ID_INVALID`, `API_ID_PUBLISHED_FLOOD`) | **alle** Installationen mit dieser `api_id`, auch andere Apps mit denselben Daten | Niemand kann sich mehr anmelden, bis neue Zugangsdaten eingebaut und verteilt sind. Die Konten der Nutzer selbst bleiben intakt. |
| Einschränkung des Inhaber-Kontos bei schwerem Missbrauch | die Person, deren Telefonnummer die `api_id` gehört | sehr selten, aber der eigentliche Worst Case, weil ein persönliches Konto betroffen wäre |

Eine `api_id` hängt an der Telefonnummer, mit der sie angelegt wurde (pro Nummer ist
nur eine Applikation möglich). Mit eigenen Zugangsdaten pro Person kann das Verhalten
anderer Nutzer das eigene Konto nicht beeinträchtigen. Das ist der Grund für die
aktuelle Lösung.

Falls künftig doch eingebaute Zugangsdaten gewünscht sind, sollten sie das Risiko so
begrenzen:

- `api_id` mit einem **Zweitkonto** (eigene Telefonnummer) anlegen, nicht mit dem persönlichen Hauptkonto.
- Diese `api_id` **nur für diese App** verwenden.
- Die Option „eigene Zugangsdaten verwenden“ in der App behalten, damit Nutzer bei einer Sperre ausweichen können.
- Den `api_hash` nur über GitHub-Secrets beim Bauen einspielen, nie ins Repository einchecken. (Aus einer verteilten App lässt er sich trotzdem auslesen; das gilt für alle Telegram-Apps.)

Ob ein solches Vorgehen im konkreten Fall zulässig ist, regeln die
[Telegram API Terms of Service](https://core.telegram.org/api/terms).

## Für alle anderen (fertiger Installer)

1. Von der [Releases-Seite](https://github.com/MiSte-Git/TUA/releases) die
   passende Datei für dein Betriebssystem laden:
   - Windows: **`-setup.exe`** (empfohlen; die `.msi` gibt es auch, siehe Hinweis unten)
   - macOS: `_aarch64.dmg` (Apple Silicon) oder `_x64.dmg` (Intel)
   - Linux: `.deb`, `.rpm` oder `.AppImage` (für automatische Updates **`.AppImage` empfehlenswert**, siehe Punkt 5 unten)
2. Datei ausführen/installieren wie jedes andere Programm auf dem jeweiligen
   Betriebssystem – ein `npm`/`cargo` wird dafür nicht gebraucht.
3. Beim ersten Start fragt die App nach den Telegram-API-Zugangsdaten
   (`api_id`/`api_hash`, siehe [Telegram API-Zugangsdaten](#telegram-api-zugangsdaten)
   oben – falls noch nicht vorhanden, dort in wenigen Minuten kostenlos
   anlegen) und speichert sie danach lokal – Umgebungsvariablen sind für
   diesen Weg **nicht** nötig.
4. Die Builds sind aktuell **nicht signiert** (Code-Signing ist für eine
   spätere Version vorgesehen). Windows SmartScreen bzw. macOS Gatekeeper
   zeigen deshalb beim allerersten Start eine Warnung – "Weitere
   Informationen"/"Trotzdem ausführen" (Windows) bzw. Rechtsklick →
   "Öffnen" (macOS) bestätigt den Start einmalig.
5. Ab dann prüft die App bei jedem Start automatisch auf neue Releases und
   zeigt ein Banner an, wenn eine neuere Version verfügbar ist (siehe
   [Architektur des Auto-Updates](#architektur-des-auto-updates) unten). Der
   "Jetzt installieren"-Klick funktioniert unter Windows, macOS und bei der
   `.AppImage` vollautomatisch; bei `.deb`/`.rpm` erkennt Tauris Updater das
   Update zwar genauso, kann sich unter Linux aber nur bei einer
   AppImage-Installation selbst ersetzen – die App zeigt in dem Fall
   stattdessen einen Hinweis mit Link zur Releases-Seite für den manuellen
   Download.

### Updates und Wechsel der Version

Updates **ersetzen** die vorhandene Installation, es entsteht keine zweite.
API-Zugangsdaten, Telegram-Sitzung und gespeicherte Analysedaten liegen im
Benutzerordner (nicht im Programmordner) und bleiben bei jedem Update erhalten,
ein erneutes Anmelden ist nicht nötig.

| System / Datei | Manuelles Update von der Releases-Seite |
|---|---|
| Windows `-setup.exe` | erkennt die vorhandene Installation und ersetzt sie |
| Windows `.msi` | ersetzt eine frühere **MSI**-Installation; ein Downgrade wird abgelehnt |
| macOS `.dmg` | App in „Programme“ ziehen und „Ersetzen“ bestätigen |
| Linux `.deb` / `.rpm` | der Paketmanager aktualisiert das vorhandene Paket |
| Linux `.AppImage` | neue Datei liegt neben der alten, die alte kann gelöscht werden |

> **Windows: `.msi` und `-setup.exe` nicht mischen.** Das sind zwei getrennte
> Installationsarten, die nichts voneinander wissen. Wer erst die `.msi` und
> später die `-setup.exe` installiert (oder umgekehrt), hat die App danach zweimal
> in der Programmliste. Das Update in der App verwendet unter Windows die
> `-setup.exe`-Variante. Deshalb für Windows **nur die `-setup.exe`** verwenden.
> Falls es schon passiert ist: die `.msi`-Installation über
> „Apps & Features“ deinstallieren; die Daten bleiben erhalten.

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

## Für Entwickler:innen

### 1. Repository klonen

```bash
git clone <repo-url>
cd "Telegram User Activities"
```

### 2. Node-Abhängigkeiten installieren

```bash
npm install
```

### 3. Telegram API-Zugangsdaten (optional)

Noch keine `api_id`/`api_hash`? Siehe
[Telegram API-Zugangsdaten](#telegram-api-zugangsdaten) oben. Die App fragt
fehlende Zugangsdaten beim ersten Start über die eigene Oberfläche ab und
speichert sie danach in einer lokalen Config-Datei –
für den Dev-Modus ist das der bequemste Weg. Alternativ (z. B. für CI oder
mehrere parallele Checkouts) lassen sie sich vorab als Umgebungsvariablen
setzen, die App nimmt sie dann mit Vorrang vor der gespeicherten Config:

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

### 4c. Lokal ohne root installieren (Launcher/Desktop-Eintrag)

Alternative zu 4b für den eigenen Rechner unter Linux, analog zum Vorgehen im
"Telegram Nachrichten kopieren"-Projekt: `build_linux.sh` baut das Release-
Binary (via `npm run tauri build`) und schreibt einen Versionsstempel;
`install_linux.sh` kopiert es ohne root-Rechte nach `~/.local/share/tua/` und
legt/aktualisiert einen Desktop-Eintrag an, der auf dieses installierte
Binary zeigt - baut bei veraltetem oder fehlendem Stand automatisch neu.

```bash
./install_linux.sh              # baut bei Bedarf neu und installiert
./install_linux.sh --clean      # erzwingt vorher einen sauberen Neubau
```

Danach im Anwendungsmenü "Telegram User Activities" suchen und an
Taskleiste/Dock anheften. Rührt nichts an der Release-Pipeline/dem
Auto-Update aus 4b/GitHub Actions - beides kann parallel bestehen.

Deinstallieren:

```bash
rm -f ~/.local/share/applications/tua.desktop
rm -rf ~/.local/share/tua
```

---

## Erste Verwendung

Voraussetzungen: ein eigenes Telegram-Konto, eigene API-Zugangsdaten (siehe [Telegram API-Zugangsdaten](#telegram-api-zugangsdaten)) und Mitgliedschaft im Chat, der ausgewertet werden soll. Die App liest mit deinem Konto, sie sieht also genau das, was du in Telegram auch siehst. Für Mitgliederliste, Beitrittsdaten und Bot-Erkennung sind in Kanälen und grossen Gruppen Admin-Rechte nötig. Die Statistik zeigt unter **Eigene Rechte**, ob das der Fall ist. Ohne Admin-Rechte funktioniert die App trotzdem: Nachrichten, Reaktionen und Umfragen werden vollständig ausgewertet, nur Beitrittsdaten, Mitgliederzahl, Bot-Erkennung und die Namensvorschläge in den Suchfeldern können fehlen. Die App weist an den betroffenen Stellen darauf hin.

1. App starten. Beim allerersten Start `api_id` und `api_hash` eingeben. Der Dialog enthält eine Schritt-für-Schritt-Anleitung, wie man sie auf my.telegram.org anlegt.
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

Die Chat-URL-Eingabe ist **immer oben sichtbar** und wird von allen Tabs gemeinsam genutzt. Darunter befinden sich vier Tabs:

| Tab | Funktion |
|---|---|
| **Aktivitätsanalyse** | Nachrichten-, Reaktions- und Umfragestatistik für alle Mitglieder im gewählten Zeitraum |
| **Erste Erwähnung** | Frühester Nachweis eines bestimmten Benutzers im gesamten Chatverlauf |
| **Ein/Austritt** | Suche nach Telegram-Service-Messages für hinzugefügt, beigetreten, verlassen und entfernt |
| **Bots** | Alle Bots im Chat; einzelne Accounts lassen sich als „Kein Bot“ markieren |

Rechts in der Statusleiste steht die installierte Version. Ein Klick darauf oder auf den **i**-Knopf neben der Sprachauswahl öffnet den Info-Dialog: Version, Update-Prüfung, Links zu Quellcode, Releases und Fehlermeldungen sowie die Speicherorte der lokalen Daten.

### Tab „Aktivitätsanalyse"

| Schritt | Aktion |
|---|---|
| **Chat auswählen** | t.me-Link, `t.me/c/<ID>` oder `@username` in der Chat-URL-Eingabe oben eingeben → **Verbinden** |
| **Analysezeitraum** | Letzter Monat, 3, 6, 9 oder 12 Monate oder eigener Zeitraum von/bis |
| **Reaktionen einbeziehen** | Optional: Reaktionen mitzählen (deutlich langsamer, ein API-Aufruf pro Nachricht) |
| **Analyse starten** | Scannt die Nachrichten im Zeitraum, bei gespeicherten Daten nur das Fehlende |
| **Mindest-Nachrichten** | Wer weniger Nachrichten hat, gilt als nicht aktiv und zählt nicht zu „Wirklich aktiv“ |
| **Mindest-Reaktionen / -Umfragen-Teilnahmen** | Nur zur Hervorhebung in der Tabelle und Dokumentation im Export, kein Aktiv-Kriterium |
| **Ausschliessen** | Zeile anklicken, um ein Mitglied manuell aus der Zählung zu nehmen (erneut klicken zum Einschliessen) |
| **ST markieren** | In der Spalte ST ein Mitglied als Servant Team markieren; die Statistik zeigt dann eigene ST-Werte |
| **Exportieren** | Button oben rechts in der Statistik: Zusammenfassung und alle Einzeldaten als CSV speichern |

Filter wie Mindest-Nachrichten, Ausschluss oder ST wirken sofort auf Tabelle und Statistik, ohne neuen Scan. Ausschlüsse und ST-Markierungen werden pro Chat gespeichert.

#### Spalten in der Ergebnistabelle

| Spalte | Beschreibung |
|---|---|
| Name / @username | Anzeigename und Benutzername, 🤖 bei Bots |
| Beitritt | Datum des (letzten) Beitritts zum Chat |
| Nachrichten | Anzahl eigener Nachrichten im Zeitraum |
| Letzte Nachricht | Datum der letzten Nachricht im Zeitraum |
| Online-Status | Per Klick abrufbar (ein API-Aufruf pro Mitglied) |
| Reaktionen | Anzahl gesetzter Reaktionen (nur bei aktivierter Option) |
| Umfragen / Umfragen % | Teilnahmen an Umfragen und Anteil an allen Umfragen im Zeitraum |
| Quizze | Teilnahmen an Quiz-Umfragen |
| ST | Markierung Servant Team (anklickbar) |

Spalten erscheinen nur, wenn es im Zeitraum entsprechende Daten gibt. Alle Spalten lassen sich per Klick auf die Überschrift sortieren; über das Suchfeld wird nach Name oder @username gefiltert.

#### Markierungen in der Tabelle

| Darstellung | Bedeutung |
|---|---|
| Gelber Balken links, Badge „zählt nicht“, gelbe Nachrichtenzahl | Weniger Nachrichten als Mindest-Nachrichten, zählt nicht zu „Wirklich aktiv“ |
| Roter Balken links, Name durchgestrichen | Manuell ausgeschlossen |
| Grüner Hintergrund | Als Servant Team markiert |

Die Legende über der Tabelle zeigt die Anzahl der nicht aktiven und ausgeschlossenen Mitglieder.

#### Gespeicherte Daten (kein unnötiges Neu-Einlesen)

Die Rohdaten jeder Analyse (jede Aktivität mit Zeitstempel, Umfragen, Namen, Beitrittsdaten) werden pro Chat auf der Platte gespeichert: `~/.local/share/tua/cache/<chat_id>.json` (Linux), `%LOCALAPPDATA%\tua\cache\` (Windows), `~/Library/Application Support/tua/cache/` (macOS). Nachrichtentexte werden nicht gespeichert.

- **Filter ändern** (Mindest-Nachrichten, Reaktionen, Umfragen, Ausschluss, ST): Tabelle und Statistik rechnen sofort neu, kein Scan.
- **Zeitraum verkleinern** (z. B. 9 → 3 Monate) oder Reaktionen ausblenden: Ergebnis wird sofort aus den gespeicherten Daten berechnet. Die gespeicherten Daten bleiben vollständig, zurück auf 9 Monate geht ebenfalls sofort.
- **Zeitraum vergrössern**: Hinweis unter den Steuerelementen. **Start** lädt nur den fehlenden älteren Teil nach.
- **Neue Nachrichten**: **Start** lädt nur die Nachrichten seit dem letzten Stand nach und führt sie mit den gespeicherten Daten zusammen.
- **Komplett neu einlesen**: verwirft die gespeicherten Daten des Chats und scannt den gewählten Zeitraum neu. Nötig z. B., um Umfragestimmen zu erfassen, die nach dem Scan noch abgegeben wurden, oder wenn Reaktionen erstmals einbezogen werden sollen (das passiert dann automatisch).

Unter den Steuerelementen steht, welcher Zeitraum gespeichert ist und bis wann die Daten aktuell sind. Der Export enthält immer genau den angezeigten Zeitraum.

#### CSV-Export

Button **⤓ Exportieren** oben rechts in der Statistik-Karte. Es werden immer zwei Dateien geschrieben:

| Datei | Inhalt |
|---|---|
| `<Chat>_<von>_bis_<bis>_<Exportdatum>.csv` | Zusammenfassung: eine Zeile pro Mitglied, Summen über den ganzen analysierten Zeitraum |
| `..._Einzeldaten.csv` | **Alle** Aktivitäten des analysierten Zeitraums, eine Zeile pro Nachricht, Reaktion, Umfrage- oder Quiz-Teilnahme |

Beide Dateien beginnen mit einem Metadaten-Header (Kommentarzeilen mit `#`) mit Chat-Angaben und **allen verwendeten Filteroptionen** (analysierter Zeitraum, Reaktionen einbezogen, Mindest-Nachrichten, Mindest-Reaktionen, Mindest-Umfrageteilnahmen, Anzahl ausgeschlossener und ST-Mitglieder).

Zusammenfassung (alle Mitglieder, keine Zeilen werden weggelassen):

```
user_id, name, username, joined_date, first_message_date, last_message_date, message_count,
last_reaction_date, reaction_count, poll_participations, quiz_participations, last_poll_date,
is_bot, active, excluded, servant_team
```

Einzeldaten:

```
date, time_utc, week, month, user_id, name, username, activity, is_bot, excluded, servant_team
```

**Zeitraum nachträglich einschränken:** Die Einzeldaten in LibreOffice/Excel öffnen, die Spaltenkopf-Zeile markieren und AutoFilter setzen. Dann nach `date` (von/bis), `week` (z. B. `2026-KW41`) oder `month` (z. B. `2026-10`) filtern. Zahlen pro Mitglied für den gefilterten Zeitraum liefert eine Pivot-Tabelle (Zeilen: `name`, Spalten: `activity`, Werte: Anzahl).

Grösse: ca. 75 Byte pro Zeile, 10.000 Nachrichten ergeben rund 0,7 MB. Zeiten sind UTC. Reaktionen tragen das Datum der Nachricht, auf die reagiert wurde (Telegram liefert keinen Reaktionszeitpunkt). Einzeldaten gibt es nur für Analysen, die mit dieser Version erstellt wurden.

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
| **Abbrechen** | Laufende Suche und das Laden der Mitgliederliste können abgebrochen werden |

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

#### CSV-Export (Ein/Austritt)

Nach einer Suche erscheint oben rechts in der Ergebnis-Karte **⤓ Exportieren**. Dateiname: `<Chat>_Ein-Austritt_<User>_<von>_bis_<bis>_<Exportdatum>.csv`. Im Header stehen Suchbegriff, ausgewähltes Mitglied, Ereignistypen und Zeitraum der Suche; danach eine Zeile pro Ereignis (`event, date, time_utc, affected_user, affected_user_id, affected_username, actor, actor_user_id, chat_id, message_id`).

### Tab „Bots"

Listet alle Bots des Chats (unabhängig vom Analysezeitraum). Accounts, die fälschlich als Bot erkannt werden, lassen sich als **Kein Bot** markieren; sie werden dann in Statistik und Tabelle wie normale Mitglieder behandelt. Die Markierung wird pro Chat gespeichert.

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

**App fragt bei jedem Start erneut nach API-Zugangsdaten**
→ Die Config-Datei mit den gespeicherten Zugangsdaten konnte nicht geschrieben werden (z. B. fehlende Schreibrechte im Benutzerprofil), oder es sind widersprüchliche `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`-Umgebungsvariablen gesetzt, die Vorrang vor der gespeicherten Config haben – prüfen und ggf. entfernen (siehe oben).

**„Verbindungsfehler: ... API_ID_INVALID"**
→ Die gesendete `api_id`/`api_hash`-Kombination wird von Telegram abgelehnt (meist ein nicht zusammengehöriges Paar, ein Tippfehler oder veraltete `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`-Umgebungsvariablen, die Vorrang vor der Config haben). Beim Verbindungsaufbau wird jetzt geloggt, aus welcher Quelle die Zugangsdaten stammen sowie Länge und ein maskierter Ausschnitt von `api_hash` (kein Klartext) – im Terminal sichtbar bei `npm run tauri dev`, sonst über die von `tauri-plugin-log` geschriebene Log-Datei im App-Log-Verzeichnis.

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

---

## Release-Prozess

Ein Release entsteht aus einem Git-Tag. Die Pipeline prüft, dass die
Versionsnummer in `package.json` und `src-tauri/tauri.conf.json` mit dem Tag
übereinstimmt. Damit alles konsistent bleibt, wird sie zusätzlich in
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (Eintrag
`telegram-user-activities`) und `package-lock.json` gepflegt. Ablauf:

1. Alle Feature-Commits sind auf `main`.
2. `version` in allen genannten Dateien erhöhen und als eigenen Commit einchecken:

   ```bash
   git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
   git commit -m "Version X.Y.Z"
   ```

3. Tag setzen und pushen – das führende `v` gehört zum Tag, nicht zur
   Versionsnummer:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. Der Tag-Push startet [`release.yml`](.github/workflows/release.yml). Die
   Pipeline bricht ab, **bevor** irgendetwas gebaut wird, falls Tag und
   Versionsnummern nicht übereinstimmen. Sonst baut sie die Installer für
   Linux, macOS (Apple Silicon + Intel) und Windows und veröffentlicht daraus
   direkt ein GitHub Release (kein manueller Freigabe-Schritt, siehe
   `releaseDraft: false`).
5. In den GitHub Actions kurz prüfen, dass alle vier Matrix-Jobs
   durchgelaufen sind. Bestehende Installationen finden das neue Release
   beim nächsten App-Start automatisch über die eingebaute Update-Prüfung.

## Architektur des Auto-Updates

Die Update-Prüfung nutzt Tauris offizielles
[`updater`-Plugin](https://v2.tauri.app/plugin/updater/) und braucht dafür
weder einen eigenen Server noch Zusatzinfrastruktur:

1. Die Release-Pipeline (`.github/workflows/release.yml`) baut bei jedem
   Versions-Tag die Installer für alle drei Plattformen und signiert
   zusätzlich kleinere Update-Archive mit einem eigenen Schlüsselpaar
   (unabhängig vom fehlenden Code-Signing weiter oben – dieses Schlüsselpaar
   dient ausschließlich der Update-Integrität, nicht der Windows-/
   macOS-Signierung). Der private Schlüssel liegt als Repository-Secret
   `TAURI_SIGNING_PRIVATE_KEY`, der öffentliche Gegenpart steht in
   `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
2. Zusammen mit den Installern landet eine `latest.json` im GitHub-Release,
   die Versionsnummer, Download-URLs und Signatur der Update-Archive enthält.
3. Jede laufende App fragt bei jedem Start
   `https://github.com/MiSte-Git/TUA/releases/latest/download/latest.json`
   ab (siehe `plugins.updater.endpoints` in `tauri.conf.json`). Ist die dort
   genannte Version neuer, zeigt die App ein Banner mit einem
   "Jetzt installieren"-Button; ein Klick lädt das signierte Update-Archiv,
   prüft die Signatur gegen den eingebauten Public Key, installiert es und
   startet die App neu.
4. Ausnahme: Unter Linux kann sich Tauris Updater nur bei einer
   AppImage-Installation selbst ersetzen (offizielle Einschränkung, siehe
   [Tauri-Doku](https://v2.tauri.app/plugin/updater/)). Bei `.deb`/`.rpm`
   schlägt der Installieren-Klick mit einem Fehler fehl, den
   `UpdateBanner.tsx` abfängt und stattdessen als Hinweis mit Link zur
   Releases-Seite anzeigt (`update.manualRequired` in den
   Übersetzungsdateien) - die Erkennung einer neuen Version funktioniert
   davon unabhängig immer.
5. Schlägt die Prüfung selbst fehl (kein Internet, kein Release vorhanden,
   Dev-Build ohne veröffentlichten Tag) bleibt das Banner einfach unsichtbar
   – die App funktioniert normal weiter.

Das Release wird direkt bei Fertigstellung der Pipeline veröffentlicht (kein
Entwurf/manueller Freigabe-Schritt) - jeder erfolgreich gebaute Tag-Push löst
also unmittelbar das Update-Banner bei bestehenden Nutzer:innen aus. Bewusst
so gewählt, weil die kleine Nutzerzahl eine manuelle Vorab-Prüfung nicht
aufwiegt; bei Bedarf lässt sich das über `releaseDraft: true` in
`release.yml` wieder umkehren.
