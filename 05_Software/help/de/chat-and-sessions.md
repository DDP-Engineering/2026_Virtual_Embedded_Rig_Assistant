# Chat und Sitzungen

Eine Sitzung ist eine Unterhaltung mit dem Agenten innerhalb eines Workbenchs. VERA speichert jede Sitzung im Workbench, sodass Sie die App schließen und später weitermachen können. Mehrere Sitzungen können gleichzeitig laufen.

## Sitzungen starten und verwalten

- **Neue Sitzung** startet eine Unterhaltung im geöffneten Workbench. Gibt es eine ungenutzte leere Sitzung, öffnet VERA diese, statt eine weitere anzulegen.
- Die erste Nachricht wird zum Titel. **Umbenennen** legt einen eigenen Titel fest.
- **Sitzungen suchen** findet Sitzungen nach Titel und Nachrichtentext.
- Jede Sitzungszeile zeigt den Zeitpunkt der letzten Aktivität und hat ein Menü mit **Markdown exportieren**, **JSON exportieren**, **Umbenennen**, **Nach oben verschieben**, **Nach unten verschieben**, **Archivieren** und **Löschen**.
- Eine Sitzung zeigt ihren Zustand: **Bereit**, **Läuft**, **Wartet auf Freigabe** oder **Fehler**.

## Eine Nachricht schreiben

Schreiben Sie in das Nachrichtenfeld (**Fragen Sie VERA zu Ihrem Projekt…**). Enter sendet, Shift+Enter fügt eine Zeile ein, und @ vervollständigt Pfade von Workbench-Dateien. Um dem Agenten eine Datei zu geben, wählen Sie im Tab **Dateien** an der Datei **Als Kontext anhängen**; sie erscheint als Chip über dem Nachrichtenfeld.

Neben dem Nachrichtenfeld wählen Sie **Modell**, **Reasoning-Stufe** und **Berechtigungsmodus** dieser Sitzung. Neue Sitzungen übernehmen Modell und Berechtigungsmodus aus den Workbench-Einstellungen.

## Einen laufenden Durchlauf steuern oder stoppen

Während der Agent arbeitet, können Sie weiterschreiben und weitere Nachrichten senden, zum Beispiel „prüfe auch die Errata“. Sie zeigen **Zustellung ausstehend**, bis der Agent sie bei seinem nächsten Schritt aufnimmt. Solange eine Freigabekarte auf Ihre Entscheidung wartet, ist das Senden angehalten.

**Stoppen** beendet den laufenden Durchlauf. Auch Escape fragt **Laufenden Durchlauf stoppen?**. Bereits abgeschlossene Arbeit, etwa angewendete Dateiänderungen, bleibt erhalten.

## Detailgrade

**Detailgrad** wird pro Workbench unter **Workbench bearbeiten** → **Agent und Chat** festgelegt:

| Stufe | Was die Unterhaltung zeigt |
|---|---|
| **Ausführlich** | Jeden Werkzeugaufruf mit Argumenten und Ausgabe, das Reasoning des Modells und Token-Statistiken unter jeder Ihrer Nachrichten |
| **Normal** | Routinemäßige Werkzeugaufrufe, gruppiert in einer aufklappbaren Zeile **Vorgänge** |
| **Minimal** | Nur die Unterhaltung; routinemäßige Werkzeugaufrufe sind ausgeblendet, und eine Arbeitsanzeige ist zu sehen, solange der Agent arbeitet |

Freigaben, die auf Sie warten, Fehler und Download-Karten werden auf jeder Stufe angezeigt; Freigaben, die der Berechtigungsmodus erteilt hat, sind bei **Minimal** ausgeblendet und bei **Normal** gruppiert. Die Stufe ändert nur die Anzeige; die gespeicherte Sitzung und ihre Exporte sind immer vollständig.

Werkzeugaktivitäten zeigen eine kurze Aktionsbeschreibung, die betroffene Datei, Seite oder den Befehl und den Status. Klappen Sie sie für das Ergebnis oder den genauen Befehl und Arbeitsordner auf. **Technische Details** enthält Werkzeugname, Dauer, ursprüngliche Argumente und Rohergebnis; große gespeicherte Auszüge lassen sich weiterhin vollständig laden. Ein Exitcode ungleich null erscheint als Fehler, Hintergrundläufe sind gesondert gekennzeichnet. Detailstufen und Genehmigungsanfragen behalten ihr Verhalten. Aufgeklappte Planaktualisierungen zeigen die tatsächlichen Aufgaben und ihren Status; technische Details bleiben optional und getrennt.

## Reasoning

Bei Modellen, die es unterstützen, bietet **Reasoning-Stufe** die Option **Standard** und die Stufen, die das Modell angibt, zum Beispiel **Minimal**, **Niedrig**, **Mittel**, **Hoch** oder **Maximum**. Auf höheren Stufen denkt das Modell länger nach, bevor es antwortet. Bei Modellen ohne Reasoning-Stufen ist das Steuerelement ausgeblendet. Sie können die Stufe während eines Durchlaufs ändern; die neue Stufe gilt ab der nächsten Anfrage. Der Reasoning-Text selbst wird nur bei **Ausführlich** angezeigt.

## Lange Sitzungen und Kontext

Die Kontextanzeige zeigt **Kontextnutzung** als Prozentsatz des Kontextfensters des Modells; wählen Sie sie aus, um Nutzung und Limits zu sehen. Wird eine Sitzung für das Modell zu lang, fasst VERA den älteren Verlauf zusammen (**Verlauf wird zusammengefasst…**). Das vollständige Transkript bleibt gespeichert und sichtbar.

**In Unterhaltung suchen** durchsucht die aktuelle Sitzung. Die Markierungsleiste am linken Rand der Unterhaltung hat eine Markierung pro Nachricht von Ihnen; zeigen Sie auf eine Markierung, um eine Vorschau der Nachricht zu sehen, und wählen Sie sie aus, um dorthin zu springen.

## Archivieren, löschen und exportieren

- **Archivieren** verschiebt eine abgeschlossene Sitzung in **Archivierte Sitzungen**; **Wiederherstellen** holt sie zurück. Nichts geht verloren.
- **Löschen** entfernt die Sitzung und ihre Artefakte nach einer Bestätigung. Dateien, die der Agent heruntergeladen hat, bleiben im Workbench.
- **Markdown exportieren** schreibt ein lesbares Transkript mit Werkzeugzusammenfassungen, Quellenverweisen und angewendeten Änderungen; **JSON exportieren** schreibt die vollständige Ereignisaufzeichnung. Beide öffnen einen Speichern-Dialog und funktionieren auch in schreibgeschützten Workbenches.

Gespeicherte Nachrichtenlesezeichen bleiben im JSON-Export erhalten; Markdown kennzeichnet markierte Nutzernachrichten. Lesezeichen gehören zur Sitzung und werden nicht an den Agenten gesendet.

## Der rechte Bereich

**Rechten Bereich ein- oder ausblenden** zeigt Tabs für die geöffnete Sitzung: **Anweisungen und Skills** (Workbench-Anweisungen und verfügbare Skills), **Dateien**, **Änderungen**, **Artefakte** (Textergebnisse, die der Agent gespeichert hat, mit **Exportieren** und **Im Ordner anzeigen**), **Plan** (die Aufgabenliste des Agenten) und **Läufe** (Programmläufe von Plugins).

## Lesezeichen

Bewegen Sie den Zeiger über eine eigene Nachricht oder erreichen Sie ihr Lesezeichensymbol mit Tab. **Lesezeichen setzen** markiert sie; das gefüllte Symbol bietet **Lesezeichen entfernen**. Die Vorschau an der Leiste zeigt die erste Nachrichtenzeile und den Anfang der Agentenantwort mit derselben Lesezeichenaktion. Änderungen erscheinen sofort; bei einem Speicherfehler wird der vorherige Zustand wiederhergestellt und ein Fehler angezeigt. Archivierte Sitzungen und schreibgeschützte Workbenches erlauben nur das Anzeigen.

Markierte Positionen auf der Leiste sind gefüllt, in der Primärfarbe und etwas länger. Eine Gruppe ist markiert, sobald eine ihrer Nachrichten ein Lesezeichen hat. Mit **Nächstes Lesezeichen** (**Ctrl+Alt+N**) und **Vorheriges Lesezeichen** (**Ctrl+Alt+P**) springen Sie zwischen markierten Nachrichten; am ersten oder letzten Lesezeichen endet die Navigation. Ändern Sie die Tasten unter **Einstellungen → Tastenkombinationen**.

## Shell-Befehle

Nutzen Sie nicht interaktive Optionen: die Standardeingabe des Agenten ist geschlossen. Vordergrundbefehle liefern den Exitcode, die letzten 12.000 Ausgabezeichen und das vollständige Protokoll in `.vera/runs`. Hintergrundbefehle liefern eine Kennung; der Agent liest `program_output`, nutzt `until` für eine Bereitschaftsmeldung und beendet sie mit `program_stop`. Sie überleben einen abgeschlossenen Werkzeugaufruf und enden mit Sitzung, App oder dem Bypass-Modus, der sie gestartet hat. Die lokale Ansicht der Läufe folgt der Geheimnismaskierung für Programmläufe; lokale Protokolle behalten die Originalausgabe. Kindprozesse erben Benutzerumgebungsvariablen ohne VERA-Anbieterschlüssel oder gespeicherte Zugangsdaten. Befehle sind auf 4.096 Zeichen begrenzt.

Fragen verlangt für jeden Befehl eine Freigabe. In Automatisch bearbeiten speichert Immer erlauben das gewählte wörtliche Befehlspräfix für diesen Workbench; npm test erlaubt beispielsweise auch npm test -- --watch=false. Workbench bearbeiten > Agent listet die Präfixe; nach Entfernen und Speichern wird sofort wieder gefragt. Rekursives Löschen, erzwungenes Pushen, Hard-Resets, Formatieren und Datenträgerwerkzeuge fragen außerhalb von Bypass immer nach und können nicht gespeichert werden. Komplexe Syntax, Anführungszeichen, Escape-Zeichen, Pipes, Ersetzungen und Befehlstrenner verlangen ebenfalls eine ausdrückliche Freigabe. Präfixe erlauben Argumente; sie isolieren die Wirkung von Skripten nicht.

## Zusätzliche Ordner

Die normalen Werkzeuge read, list, glob, grep, write und edit sowie Shell-Arbeitsordner nutzen diese Ordner mit denselben Freigaben für Fragen oder Automatisch bearbeiten wie der Workbench. Externe Pfade müssen absolut sein; relative Pfade beginnen weiter im Haupt-Workbench. Externe Quellen haben absolute Identitäten ohne lokale Dokumentzitate. Ignorierregeln bleiben aktiv; VERA-Anwendungsdaten sind auch über Verknüpfungen gesperrt. Hinzufügen indiziert die Ordner nicht: Index, Protokolle, Artefakte und erzeugte Daten bleiben im Haupt-Workbench. Befehle behalten die Rechte des Systemkontos und laufen ohne Sandbox.

## Befehle in Läufe

Öffnen Sie **Läufe** im rechten Bereich für den genauen Befehl, Ordner, laufende Ausgabe, Exit-Code und Dauer. **Stoppen** beendet den gesamten Prozessbaum; der Agent sieht den Stopp beim nächsten Lesen der Ausgabe. Bei beendeten Läufen öffnet **Protokoll öffnen** das vollständige aufbewahrte Protokoll im Textbetrachter, auch die Ausgabe vor dem angezeigten Ende. Standardmäßig ist die aktuelle Sitzung ausgewählt; **Alle Sitzungen** zeigt andere Läufe. Plugin-Läufe behalten ihre deklarierten Programmnamen. Die Maskierung von Programmläufen ist standardmäßig aus. Eingeschaltet maskiert sie gespeicherte Geheimnisse in Argumenten, Befehlen, Ordnern, Fehlern, Ausgaben und Programmstatus. Die Workbench-Auswahl hat Vorrang vor dem App-Standard. Änderungen aktualisieren offene Protokolle einschließlich vollständiger Protokolle im Betrachter; lokale Protokolle behalten den Originaltext.

## Benutzerterminal

Öffnen Sie **Terminal** rechts oder drücken Sie **Ctrl+Shift+T**. Die interaktive Shell startet im Workbench-Ordner gemäß Einstellungen → Befehle. **Neues Terminal** erstellt Tabs; **Terminal schließen** beendet sie. Größenänderungen brechen die Ausgabe neu um. Interaktive Programme nehmen Ihre Eingaben an. Das Ende einer Agentensitzung lässt Benutzerterminals weiterlaufen; Schließen oder Wechseln des Workbenchs und Beenden von VERA schließen sie. Native Terminalunterstützung ist enthalten.

Jedes Terminal beginnt privat. Aktivieren Sie **Agent darf dieses Terminal lesen** separat für jedes freizugebende Terminal. Der Agent kann freigegebene Terminals auflisten und begrenzte letzte Ausgabe mit terminal_read lesen; er kann keine Terminals erstellen, beschreiben, skalieren oder schließen. Deaktivieren oder Schließen verhindert weitere Zugriffe. Bereits geteilte Ausgabe bleibt im Sitzungsverlauf. Die Shell verwendet Ihre Betriebssystemrechte ohne Sandbox. VERA filtert geerbte Zugangsdatenvariablen. Die lokale Terminalausgabe folgt der standardmäßig ausgeschalteten Maskierung von Programmläufen; erlaubte Agentenlesezugriffe folgen der unabhängigen, standardmäßig aktiven Auswahl Agent und Modell. Shell-Profil und Programme bleiben unter Ihrer Kontrolle.

## Geheimnismaskierung für Agent und Exporte

Agent und Modell maskiert Werkzeugergebnisse für den Anbieter, gestreamte Antworten sowie Suche und Anzeige von Sitzungen. Artefakte und Exporte steuert unabhängig davon gespeicherte Artefaktinhalte und Beschreibungen, Artefaktexporte und JSON-/Markdown-Sitzungsexporte. Beide sind standardmäßig aktiv; eine ausdrückliche Workbench-Auswahl hat Vorrang vor dem aktuellen App-Standard. Ohne Agentenmaskierung können gespeicherte Geheimnisse aus Dateien oder Werkzeugausgaben den Anbieter erreichen. Programmläufe und Anzeige ändern diese Regeln nicht. Anbieterfehler, Verbindungstests und Diagnoseprotokolle maskieren gespeicherte Zugangsdaten immer. Terminalzugriffe benötigen weiterhin die Zustimmung für genau dieses Terminal. Bereits als [REDACTED] gespeicherter Text wird durch Ausschalten nicht wiederhergestellt; lesen Sie die Originalquelle neu oder erstellen Sie das Artefakt erneut.
