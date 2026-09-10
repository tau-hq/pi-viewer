# Paritaet zwischen Pis Terminal-Oberflaeche und Tau

Stand 2026-09-10, Pi 0.85.1. Grundlage: zwei vollstaendige Inventare (Pis Doku und Quellcode
gegen Taus Client, Host und Erweiterung). Frage: kann ein Nutzer in Tau alles einstellen, was
er in Pis TUI/CLI einstellen kann?

**Kurzantwort seit 2026-09-10 abends: ja, bis auf drei bewusste Ausnahmen.** Die Abschnitte 3
und 4 sind abgearbeitet (Runden A und B). Was heute noch fehlt, steht in Abschnitt 7.

## 1. Vollstaendig abgedeckt (eigene Bedienelemente)

| Bereich | In Tau |
|---|---|
| Modell waehlen | Suchbare Auswahl nach Anbieter gruppiert |
| Denkstufe | Auswahl aus der Liste des Modells |
| Anbieter-Anmeldung | Schluessel, OAuth, Gerätecode, Abmelden |
| Sitzungen | Neu, oeffnen, umbenennen, loeschen, Prozess stoppen, Schnellwechsel |
| Verzweigen | Fork mit Auswahl der Nachricht, Klonen, Baumnavigation mit Zusammenfassung |
| Kompaktierung | Manuell mit eigenen Anweisungen |
| Export | HTML und JSONL |
| Projektvertrauen | Vertrauen, ablehnen, erneut fragen (mehr als Pi: Pi kann nicht zuruecksetzen) |
| Werkzeuge an/aus | Schalter je Werkzeug (Pi hat dafuer gar keine Oberflaeche) |
| Freigabemodus | Vier Stufen inklusive autonom (in Pi nicht vorhanden) |
| Ressourcen neu laden | Menuepunkt |
| Warteschlange | Anzeigen und leeren |
| Shell | `!` und `!!`, plus echte Terminals |
| Bilder | Auswahl, Einfuegen, Ziehen und Ablegen |

## 2. Nur als roher JSON-Text (Klasse: unbequem, aber moeglich)

Der Konfigurationseditor bearbeitet `settings.json`, `models.json` und `keybindings.json`
je global und projektbezogen. Pi hat fuer 36 dieser Einstellungen typisierte Menueeintraege,
Tau nur ein Textfeld mit JSON-Pruefung.

Davon sind fuer eine Weboberflaeche **irrelevant** (rein terminalbezogen, 14 Stueck):
Bilder im Terminal und deren Breite, Hardware-Cursor, Editor- und Ausgabepolsterung,
Vervollstaendigungsanzahl, Leeren beim Verkleinern, Terminal-Fortschritt, Doppel-Escape,
TUI-Modus samt drei Vollbildoptionen, Startmeldungen, Changelog einklappen.

**Relevant und heute nur als JSON** (Auswahl): Transport und HTTP-Zeitlimit, Denkblöcke
verbergen, Mermaid, Hinweise bei Cache-Fehlgriffen, Telemetrie, Standardvertrauen fuer neue
Projekte, Standardfilter im Baum, Warnung bei Anbieter-Zusatzkosten, Denkstufe je Modell,
Bilder verkleinern oder blockieren, Skill-Befehle, dazu die rund 30 Schluessel, die auch in
Pi nur per Datei gesetzt werden (Wiederholungen, Kompaktierungsbudgets, externer Editor,
Shell-Pfad, Proxy, Werkzeug-Standardsatz, Sitzungsverzeichnis).

## 3. Vom Host unterstuetzt, aber ohne Bedienelement (4 Stueck, klein)

| Befehl | Was fehlt |
|---|---|
| `setSteeringMode` | Alle Steuerungsnachrichten auf einmal oder eine pro Zug |
| `setFollowUpMode` | dasselbe fuer Nachfassnachrichten |
| `setAutoCompaction` | automatische Kompaktierung an oder aus |
| `setAutoRetry` | automatische Wiederholung an oder aus |

## 4. Gar nicht erreichbar (die echten Luecken)

| Nr | Fehlt | Pi-Aequivalent | Aufwand |
|---|---|---|---|
| 1 | Pakete verwalten: installieren, entfernen, auflisten, aktualisieren | `pi install/remove/list/update` | mittel, braucht Host-Befehle |
| 2 | Ressourcen einzeln an- und abschalten (Skills, Prompts, Erweiterungen, Themes) je Bereich | `pi config` | mittel, braucht Host-Befehle |
| 3 | Modellauswahl fuer den Schnellwechsel festlegen und ordnen | `/scoped-models`, `enabledModels` | klein |
| 4 | Sitzung aus JSONL importieren | `/import` | klein, braucht Host-Befehl |
| 5 | Sitzung teilen (Gist plus Link) | `/share` | klein, braucht Host-Befehl und GitHub-Token |
| 6 | Letzte Antwort in die Ablage kopieren | `/copy` | sehr klein |
| 7 | Tastenkuerzel-Uebersicht | `/hotkeys` | sehr klein |
| 8 | Changelog anzeigen | `/changelog` | sehr klein |
| 9 | Modellkatalog aktualisieren | `pi update --models` | klein |
| 10 | Baumfilter und Marken im Baumdialog | `/tree` mit Ctrl+D/T/U/L/A, Shift+L | klein |
| 11 | Optionen beim Sitzungsstart: Systemprompt, Werkzeug-Allowlist, zusaetzliche Erweiterungen, fluechtige Sitzung, Kontextdateien aus | CLI-Schalter | mittel |
| 12 | Einzelne Eintraege der Warteschlange entfernen oder bearbeiten | `Alt+Up` in Pi | klein |
| 13 | Eigene Tastenkuerzel fuer die Weboberflaeche | `keybindings.json` gilt nur fuer die TUI | mittel |
| 14 | Typisierte Bedienelemente statt JSON fuer Klasse 2 | `/settings` | mittel, rund 22 Eintraege |

## 5. Was Tau besser kann als Pis Oberflaeche

Freigabemodi inklusive autonomem Betrieb, Werkzeugschalter, Vertrauen zurueckziehen, mehrere
Sitzungen gleichzeitig sichtbar, Terminals neben dem Chat, echte Markdown- und Diff-Darstellung,
Mobilbedienung, und Sitzungen laufen weiter wenn der Browser zugeht.

## 6. Erledigt (Runden A und B, 2026-09-10)

**Runde A:** die vier Schalter aus Abschnitt 3 (jetzt in einem Dialog "Session settings", mit
dem Hinweis, dass Pi sie global speichert), Modellauswahl fuer den Schnellwechsel, Import aus
JSONL, letzte Antwort kopieren, Tastenkuerzel-Uebersicht, Changelog, Modellkatalog
aktualisieren, Baumfilter samt Markenanzeige, einzelne Warteschlangeneintraege entfernen.

**Runde B:** Paketverwaltung (auflisten, installieren, entfernen, aktualisieren, je Bereich),
Ressourcenschalter fuer Erweiterungen, Skills, Prompts und Themes, erweiterte Startoptionen
beim Anlegen einer Sitzung (Systemprompt, Werkzeugbeschraenkung, zusaetzliche Erweiterungen,
Kontextdateien aus, fluechtige Sitzung, Denkstufe), und ein Formular fuer 29 Einstellungen
statt rohem JSON, mit Anzeige des wirksamen Werts und Kennzeichnung geerbter Werte. Der
JSON-Editor bleibt als Reiter "Advanced".

## 7. Nachtrag 2026-09-10: drei uebersehene Punkte, geschlossen

Beim Nachpruefen fuer die Frage "haben wir wirklich alles?" fielen drei interaktive Faehigkeiten
auf, die in Abschnitt 4 fehlten. Alle drei sind eingebaut:

| Punkt | Loesung |
|---|---|
| Dateiverweise mit `@` im Eingabefeld | Host-Befehl `fs.searchFiles` (fd, sonst begrenzter Durchlauf; Treffer im Dateinamen zuerst) plus Vorschlagsliste im Composer. Eingefuegt wird wie bei Pi nur der Pfad; die Datei liest das Modell selbst. |
| Einzelne Nachricht kopieren | Kopierknopf an jeder Nachricht, erscheint beim Darueberfahren |
| Warteschlangeneintrag zurueck in die Eingabe | Stiftknopf im Warteschlangenfeld; haengt an vorhandenen Text an, statt ihn zu ersetzen |

## 8. Ueber Pi hinaus: Suche in der ganzen Sitzung

Pis Oberflaeche kennt keine Suche ueber eine Sitzung, und die Suche des Browsers findet nur,
was gerade gerendert ist. Tau hat deshalb einen eigenen Sitzungsbefehl `search`: der Host liest
die Eintraege ueber `get_entries` frisch von Pi und durchsucht sie vollstaendig, also auch
verlassene Zweige und Verlauf, den eine Verdichtung ersetzt hat. Ein Treffer nennt die
Eintrags-ID, die Rolle, die Fundzeile mit der Position des Treffers darin und ob der Eintrag auf
dem gezeigten Pfad liegt.

Die Oberflaeche dazu sitzt oben rechts links vom Terminalknopf: das Lupensymbol waechst zum
Eingabefeld, Strg+F oeffnet es und setzt den Fokus hinein. Ein Treffer auf dem gezeigten Pfad
rollt die Nachricht in die Mitte und hebt sie kurz hervor; ein Treffer ausserhalb traegt ein
Zweigsymbol und wechselt beim Anklicken ueber `navigateTree` dorthin, genau wie ein Klick im
Sitzungsbaum. Solange das Feld offen ist, werden ab drei Zeichen **alle** Vorkommen im
Transkript gelb markiert, die des gerade betrachteten Treffers orange. Das geschieht ueber die Highlight-Registrierung des Browsers
(`CSS.highlights`, siehe `lib/text-highlight.ts`), nicht durch Umbauen des DOM: das Transkript
besteht aus gerendertem Markdown, hervorgehobenem Code und Werkzeugkarten, und nichts davon
darf umgeschrieben werden, nur um ein Wort einzufaerben. Fehlt die Registrierung im Browser,
faerbt die Suche eben nichts und funktioniert im Uebrigen weiter.

Gezaehlt werden **Vorkommen**, nicht Nachrichten: kommt das Wort in einer Nachricht dreimal
vor, sind das drei Treffer, und die Ergebnisliste zeigt drei Zeilen. Rechts im Feld steht die
Trefferanzeige (`3/57`) mit zwei Pfeilen. Sie laufen wie eine Suchleiste im Browser: der erste
Schritt geht auf Treffer eins, danach weiter, an beiden Enden umlaufend, und das Transkript
rollt jeweils bis zum markierten Wort. Welches Vorkommen einer Nachricht gemeint ist, zaehlt
der Host im Quelltext des Eintrags; die Markierung zaehlt im gerenderten Text. Beides stimmt
bei Text, Shell-Ausgabe und Werkzeugergebnissen ueberein; wo eine Karte etwas einklappt, wird
auf das letzte sichtbare Vorkommen begrenzt. Ein Schritt wechselt nie den Zweig; dafuer
braucht es den Klick auf die Zeile in der Ergebnisliste. Die Pfeilknoepfe verhindern ihr
mousedown, damit der Schreibfokus im Feld bleibt.

## 9. Nachtrag 2026-09-11: HTML-Export ging am Browser vorbei

Der Export-Knopf rief Pis `export_html` ohne Zielpfad auf. Pi schreibt die Datei dann ins
Arbeitsverzeichnis der Sitzung - bei einer Sitzung in `/` also in das Wurzelverzeichnis der
Maschine - und Tau meldete nur den Pfad. Beim Nutzer kam nichts an. Jetzt gibt der Host Pi einen
Pfad unter `tmpdir()` vor, liest die Datei, schickt `html` und `fileName` an den Client und
loescht sie im `finally`. Der Browser laedt sie herunter, auf dem Host bleibt nichts liegen.
Ein ausdruecklich uebergebener `outputPath` schreibt weiterhin dorthin: wer einen Pfad nennt,
will die Datei dort haben.

## 10. Nachtrag 2026-09-12: Der Baum schneidet keine Antwort mehr

Pis `navigateTree` erlaubt jeden Eintrag als Ziel. Wer eine Assistant-Nachricht mitten in einer
Antwort waehlt, behaelt Werkzeugaufrufe ohne ihre Ergebnisse; Pis Modellschicht fuellt die dann
mit kuenstlichen Fehlern ("No result provided", `transform-messages.js`). Andres Entscheidung:
so etwas soll die Oberflaeche gar nicht erst anbieten. Waehlbar sind im Baum deshalb nur

- **direkt vor einer User-Nachricht** (Pis eigenes Verhalten: Blatt auf den Eintrag davor, Text
  zurueck ins Eingabefeld - genau das, was der Fork-Dialog bietet), und
- **das Ende eines Zweigs**, damit man in einen verlassenen Zweig zurueckkommt, so wie er stand.

Seit dem gleichen Abend (auf Andres Wunsch zunaechst testweise) zusaetzlich waehlbar:
**saubere Stellen innerhalb einer Antwort**, also nach einer reinen Textantwort oder nach dem
letzten Ergebnis einer vollstaendigen Werkzeugrunde. Das entscheidet der Host (`TreeNode.cleanCut`
in `toTree`): er fuehrt je Pfad die noch offenen Werkzeugaufrufe mit, eine Assistant-Nachricht
oeffnet ihre, ein Werkzeugergebnis schliesst seines; abgebrochene oder fehlerhafte Antworten
oeffnen nichts, weil Pi sie aus dem Kontext wirft, gelten aber selbst nie als sauber. Angeboten
werden davon nur Assistant-, Werkzeug- und Shell-Eintraege, keine Einstellungseintraege.

Alle anderen Zeilen bleiben zur Orientierung sichtbar, sind aber nicht klickbar. Pis RPC-Modus
reicht den Text der zurueckgenommenen Nachricht nicht an Erweiterungen weiter (`rpc-mode.js`
gibt nur `cancelled` zurueck), deshalb liest der Host ihn vor dem Sprung aus seinem
Eintrags-Cache und schickt ihn als `editor.set` an das Eingabefeld. Die Sitzungssuche landet bei
einem Treffer auf einem anderen Zweig am Ende der Antwort, in der er steht - also direkt vor der
naechsten User-Nachricht, oder am Zweigende - und nie mitten darin.

## 11. Was bewusst offen bleibt

| Punkt | Grund |
|---|---|
| Sitzung teilen (`/share`) | braucht ein GitHub-Token und laedt Inhalte zu einem Fremddienst |
| Eigene Tastenkuerzel fuer die Weboberflaeche | Komfort; `keybindings.json` gilt nur fuer Pis Terminal |
| Marken im Sitzungsbaum bearbeiten | Pis RPC-Modus bietet dafuer keinen Befehl |
| Rund 14 rein terminalbezogene Einstellungen | in einer Weboberflaeche bedeutungslos |
| `!`-Shell-Befehle in der Eingabezeile | Andres Entscheidung 2026-09-11: wer eine Shell will, nimmt den Terminal-Bereich oben rechts. Der Host-Befehl `bash` bleibt (Pi kann es, Tests nutzen es), nur die Eingabebox bietet es nicht mehr an. |
