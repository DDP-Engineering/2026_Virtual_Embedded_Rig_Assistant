# Erweiterte Einstellungen

Erweiterte Einstellungen passen Grenzen an, die die meisten Benutzer nie ändern müssen. Sie sind ausgeblendet, bis Sie **Erweiterte Einstellungen anzeigen** unter **Einstellungen** → **Erweitert** einschalten. Das Ausschalten blendet sie nur aus: bereits gesetzte Werte gelten weiter.

Öffnen Sie in den Anwendungseinstellungen eine Gruppe, um ihre Einstellungen anzuzeigen. **Nur geänderte Werte** zeigt gespeicherte Abweichungen und ausstehende Änderungen einschließlich zurückgesetzter Werte.

## Wo sie sich befinden

- **Einstellungen** → **Erweitert**: Werte für die ganze Anwendung.
- **Workbench bearbeiten** → **Erweitert**: Werte für eine Workbench, die mit der Workbench gespeichert werden. Sie stehen in `.vera/workbench.yaml`.
- Das Sitzungsmenü (**…** neben einer Sitzung) → **Erweiterte Einstellungen**: Werte für eine Unterhaltung. **Speichern** legt sie mit der Sitzung ab, und sie bleiben nach einem Neustart erhalten; **Abbrechen** schließt ohne Änderungen.

## Welcher Wert gilt

Ein Sitzungswert hat Vorrang vor einem Workbench-Wert, dieser vor dem Anwendungswert und dieser vor dem eingebauten Standard. Ein leeres Feld erbt; es zeigt den geerbten Wert und seine Herkunft, zum Beispiel „200 (Standard)“. **Zurücksetzen** löscht den Wert auf dieser Ebene. Ein Workbench- oder Sitzungswert darf höher oder niedriger als der Anwendungswert sein.

Ein Wert außerhalb des Bereichs einer Einstellung wird bei der Eingabe abgelehnt. Ein von Hand in einer Datei bearbeiteter Wert außerhalb des Bereichs wird ignoriert, und die nächste Ebene gilt.

## Wann eine Änderung gilt

Das Symbol neben jeder Einstellung zeigt, wann eine Änderung wirksam wird: sofort, für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung, nach dem Neuindizieren, nach dem erneuten Öffnen der Workbench oder nach einem Neustart von VERA.

## Einstellungen

Jede Einstellung erscheint nur auf den genannten Ebenen. Ein Schalter bietet **Übernehmen**, **Ein** und **Aus**; **Übernehmen** zeigt den geerbten Zustand, zum Beispiel „Ein (Standard)“. **Zeilen pro Seite** bietet **Übernehmen**, 10, 20 und 50.

| Einstellung | Ebenen | Bereich | Standard | Gilt |
|---|---|---|---|---|
| Werkzeugaufrufe pro Durchlauf | Anwendung, Workbench, Sitzung | 10–500 | 200 | Sofort |
| Zeitlimit ohne Modellausgabe (s) | Anwendung, Sitzung | 30–3600 | 300 | Sofort |
| Wartezeit auf Antwort-Header gehosteter Anbieter (s) | Anwendung | 10–300 | 30 | Sofort |
| Zeitlimit für Modellsuche (s) | Anwendung | 5–120 | 10 | Ab dem nächsten Vorgang |
| Kompaktierung im Hintergrund | Anwendung, Workbench | Ein / Aus | Ein | Sofort |
| Kompaktierungsschwelle (%) | Anwendung, Workbench | 50–95 | 80 | Sofort |
| Wörtlich behaltener jüngster Verlauf (Token) | Anwendung, Workbench | 0–100000 | 20000 | Sofort |
| Größe der Werkzeugergebnisse in Zusammenfassungen (Zeichen) | Anwendung | 500–8000 | 2000 | Sofort |
| Zusammenfassungsdurchläufe pro Anfrage | Anwendung | 1–10 | 5 | Sofort |
| Kalibrierungsreserve (%) | Anwendung | 100–150 | 110 | Sofort |
| Token-Zählung des Anbieters verwenden | Anwendung | Ein / Aus | Ein | Sofort |
| Delegierte Sitzungen pro Workbench | Anwendung | 1–8 | 3 | Sofort |
| Gleichzeitige Durchläufe | Anwendung | 1–16 | 4 | Sofort |
| Automatische Kompaktierung | Sitzung | Ein / Aus | Ein | Sofort |
| Größe eines Werkzeugergebnisses (Zeichen) | Anwendung | 8000–128000 | 32000 | Sofort |
| Lesefenster (Zeilen) | Anwendung | 500–10000 | 2000 | Sofort |
| Lesegröße (Zeichen) | Anwendung | 10000–120000 | 30000 | Sofort |
| Grep-Ergebnisse | Anwendung | 50–2000 | 500 | Sofort |
| Dateigröße für grep (MiB) | Anwendung | 1–50 | 5 | Sofort |
| Glob-Ergebnisse | Anwendung | 100–5000 | 500 | Sofort |
| Bilder pro Nachricht | Anwendung | 1–32 | 8 | Sofort |
| Maximale Bilddateigröße (MiB) | Anwendung | 1–64 | 20 | Sofort |
| Worker-Frist (s) | Anwendung | 5–120 | 10 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Websuche-Ergebnisse | Anwendung | 1–8 | 5 | Sofort |
| Web-Lesegröße (Zeichen) | Anwendung | 1000–16000 | 12000 | Sofort |
| Zeitlimit für Webanfragen (s) | Anwendung | 5–120 | 30 | Sofort |
| Zeitlimit für Browser-Navigation (s) | Anwendung | 5–60 | Automatisch | Ab dem nächsten Vorgang |
| Downloadgröße (MiB) | Anwendung | 10–1000 | 100 | Sofort |
| Zeitlimit für Downloads (s) | Anwendung | 30–1800 | 120 | Sofort |
| Hintergrundprogramme pro Sitzung | Anwendung | 1–16 | 4 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Behaltene Lauf-Logs | Anwendung | 20–2000 | 200 | Sofort |
| Größe eines Lauf-Logs (MiB) | Anwendung | 8–1024 | 64 | Sofort |
| Standardzeitlimit für Programme (s) | Anwendung, Workbench | 60–3600 | 600 | Sofort |
| Zeitobergrenze für Shell-Befehle (s) | Anwendung, Workbench | 60–3600 | 600 | Sofort |
| Maximale Textdateigröße (MiB) | Workbench | 1–64 | 20 | Nach dem Neuindizieren |
| Volumenwarnung: Dateien | Anwendung, Workbench | 500–100000 | 2000 | Sofort |
| Volumenwarnung: Größe (MiB) | Anwendung, Workbench | 512–51200 | 2048 | Sofort |
| Ergebnisse im Docs-Bereich | Anwendung, Workbench | 10–100 | 20 | Sofort |
| Zeitlimit für die Dokumentextraktion (s) | Anwendung | 30–1800 | 120 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Indizierungspause (ms) | Anwendung | 250–10000 | 1000 | Sofort |
| Leerlaufzeit des Embedding-Workers (s) | Anwendung | 10–600 | 60 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Zeitlimit für Transkription (s) | Anwendung | 30–300 | 120 | Ab dem nächsten Vorgang |
| Terminals pro Workbench | Anwendung | 1–16 | 8 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Terminalpuffer (Ki Zeichen) | Anwendung | 64–1024 | 256 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Terminal-Verlauf (Zeilen) | Anwendung | 1000–50000 | 3000 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Terminalausgabe für den Agenten (Zeichen) | Anwendung | 2000–64000 | 12000 | Sofort |
| Intervall der Updateprüfung (h) | Anwendung | 1–168 | 6 | Sofort |
| Intervall der Plugin-Katalogprüfung (h) | Anwendung | 1–168 | 24 | Sofort |
| Aufbewahrung der Logs (Tage) | Anwendung | 1–90 | 7 | Sofort |
| Zuerst gezeigte Verlaufszeilen | Anwendung | 20–200 | 40 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Verlaufszeilen pro Nachladen | Anwendung | 50–500 | 100 | Für das nächste Terminal, den nächsten Worker, Lauf oder die nächste geöffnete Sitzung |
| Zeilen pro Seite | Anwendung | 10, 20, 50 | 10 | Sofort |

**Werkzeugaufrufe pro Durchlauf** gibt an, wie viele Werkzeugaufrufe ein Agentendurchlauf ausführen darf. Ist die Grenze erreicht, führt VERA in diesem Durchlauf keine Werkzeuge mehr aus und lässt den Agenten zusammenfassen, was erledigt ist und was noch fehlt; danach zeigt der Chat **Fortsetzen**, das eine Nachricht sendet, damit der Agent dort weitermacht.

**Zeitlimit ohne Modellausgabe** gibt an, wie lange ein gehostetes Modell nichts senden darf, bevor die Anfrage mit einer Zeitüberschreitung endet; erhöhen Sie es für langsame Reasoning-Modelle. **Wartezeit auf Antwort-Header gehosteter Anbieter** gibt an, wie lange VERA wartet, bis ein gehosteter Anbieter zu antworten beginnt. Ein eigener Endpunkt verwendet für beides sein eigenes **Antwort-Timeout**.

**Kontextkompaktierung.** Füllt eine Unterhaltung mehr als die **Kompaktierungsschwelle** des Eingabebudgets des Modells, fasst VERA den früheren Verlauf zusammen und behält den jüngsten Teil wörtlich (**Wörtlich behaltener jüngster Verlauf**, höchstens ein Fünftel des Budgets). Mit **Kompaktierung im Hintergrund** läuft die Zusammenfassung direkt nach einem Durchlauf; ist sie aus, fasst die nächste Nachricht bei Bedarf zuerst zusammen. **Größe der Werkzeugergebnisse in Zusammenfassungen** und **Zusammenfassungsdurchläufe pro Anfrage** begrenzen, wie viel jedes Werkzeugergebnisses eine Zusammenfassung enthält und wie viele Zusammenfassungen eine Anfrage erstellen darf. Ist **Automatische Kompaktierung** aus, sendet eine Sitzung ihren ganzen Verlauf, bis er nicht mehr passt; der Durchlauf endet dann am Kontextlimit.

**Token-Zählung.** VERA zählt eine Anfrage mit dem Verhältnis, das der Anbieter für frühere Anfragen gemeldet hat, plus der **Kalibrierungsreserve**: 110 zählt 1,1-fach. Erhöhen Sie die Reserve, wenn Kontextlimit-Fehler auftreten. Schalten Sie **Token-Zählung des Anbieters verwenden** aus, wenn ein Anbieter einen falschen Verbrauch meldet; VERA zählt dann mit seiner konservativen Schätzung.

**Delegierte Sitzungen pro Workbench** gibt an, wie viele delegierte Sitzungen gleichzeitig in einer Workbench laufen dürfen. Eine weitere wird abgelehnt, bis eine endet.

**Gleichzeitige Durchläufe** gibt an, wie viele Agentendurchläufe in allen geöffneten Workbenches gleichzeitig laufen dürfen, delegierte Sitzungen eingeschlossen. Ein Durchlauf, der auf Ihre Genehmigung wartet, zählt, bis er endet. Am Limit wird eine neue Nachricht nicht gesendet und bleibt mit ihren Anhängen im Eingabefeld; sobald ein Durchlauf endet, zeigt VERA an, dass ein Durchlauf starten kann, und Sie senden sie erneut. Eine Nachricht an eine Sitzung, deren Durchlauf läuft, schließt sich diesem Durchlauf an und wird immer angenommen. Eine delegierte Sitzung, die am Limit gestartet wird, wird sofort abgelehnt. Ein kleinerer Wert beendet keinen laufenden Durchlauf; er gilt ab der nächsten Nachricht.

**Dokumente.** **Maximale Textdateigröße** begrenzt Textdokumente; PDF- und Office-Dateien verwenden **Maximale Dateigröße** unter **Dokumente & RAG**, die ihr Limit bis 500 MB erhöht oder senkt. Eine Änderung indiziert die betroffenen Dokumente erneut. **Volumenwarnung** legt fest, wann die Dokumentvorschau vor einer großen Auswahl warnt. **Ergebnisse im Docs-Bereich** gibt an, wie viele Treffer eine Suche im Docs-Bereich auflistet. **Zeitlimit für die Dokumentextraktion** ist die Grundzeit zum Lesen eines PDF- oder Office-Dokuments (große PDFs erhalten mehr), heruntergeladene PDFs eingeschlossen. **Indizierungspause** gibt an, wie lange die Indizierung nach einer Änderung wartet, und **Leerlaufzeit des Embedding-Workers**, wie lange ein unbenutzter Embedding-Worker behalten wird.

**Desktop.** **Terminals pro Workbench** begrenzt die offenen Terminals; ein kleinerer Wert schließt keines, aber ein neues wird abgelehnt, solange die Grenze erreicht ist. **Terminalpuffer** ist die Ausgabe, die jedes Terminal behält, gelesen beim Öffnen, und **Terminal-Verlauf**, wie viele Zeilen seine Ansicht zurückscrollt. **Terminalausgabe für den Agenten** ist, wie viel der neuesten Ausgabe ein Lesen des Agenten liefert; die **Größe eines Werkzeugergebnisses** begrenzt sie weiterhin. **Intervall der Updateprüfung** und **Intervall der Plugin-Katalogprüfung** legen fest, wie oft VERA prüft; eine gespeicherte Änderung startet die neue Wartezeit, ohne sofort zu prüfen. **Aufbewahrung der Logs** ist die Zahl der täglichen Logdateien, die VERA behält. **Zuerst gezeigte Verlaufszeilen** und **Verlaufszeilen pro Nachladen** legen fest, wie viele der neuesten Nachrichten eine Unterhaltung beim Öffnen sofort zeigt und wie viele ältere sie danach jeweils im Hintergrund hinzufügt, bis alle angezeigt sind. **Zeilen pro Seite** ist die Größe, mit der Listen beginnen; eine in einer Liste gewählte Größe bleibt für diese Liste.

**Werkzeuge, Programme und Web.** **Größe eines Werkzeugergebnisses** begrenzt jedes Werkzeugergebnis, das das Modell erhält; ein Wert unter der **Lesegröße** kürzt auch Lesevorgänge. **Lesefenster**, **Grep-Ergebnisse**, **Websuche-Ergebnisse** und **Web-Lesegröße** sind sowohl die Menge, wenn der Agent keine nennt, als auch das Höchste, das er anfordern kann. Grep überspringt Dateien, die größer als die **Dateigröße für grep** sind. **Worker-Frist** begrenzt jede Textsuche, Log-Analyse oder Registerdekodierung; eine bereits laufende behält ihre Frist. **Downloadgröße** wird in der Download-Freigabe angezeigt und bleibt an sie gebunden: Eine spätere Änderung ändert einen freigegebenen Download nicht, und eine größere Datei endet mit „Download exceeds the size limit.“ **Zeitlimit für Downloads** begrenzt die Übertragung; das Lesen des Texts eines heruntergeladenen PDFs behält seine eigene Frist. **Standardzeitlimit für Programme** gilt, wenn weder die Plugin-Regel noch das Programm eine Frist festlegt; **Zeitobergrenze für Shell-Befehle** begrenzt jeden Shell-Befehl im Vordergrund und steht in seiner Freigabe. **Hintergrundprogramme pro Sitzung** begrenzt die Hintergrundläufe einer Unterhaltung; ein weiterer wird als beschäftigt abgelehnt.

Das **Zeitlimit für Modellsuche** gilt für den Katalog von LM Studio oder eines vorkonfigurierten Anbieters einschließlich aller Seiten. Der Verbindungstest verwendet für jede Modellprüfung die Antwortfrist des Modells oder die Inaktivitätsfrist der Anwendung. Das **Zeitlimit für Browser-Navigation** gilt beim Öffnen einer Seite oder Folgen eines Links. Automatisch gelten 35 s beim Öffnen einschließlich Start und 12 s beim Folgen. Der Browser-Proxy begrenzt zusätzlich jede einzelne Anfrage. Das **Zeitlimit für Transkription** umfasst das Laden von Whisper und die Verarbeitung der Aufnahme.

## Jetzt kompaktieren

**Jetzt kompaktieren** in den **Erweiterten Einstellungen** einer Sitzung fasst den früheren Verlauf sofort zusammen, ohne auf die Schwelle zu warten und auch bei ausgeschalteter automatischer Kompaktierung. Es steht zur Verfügung, solange die Sitzung nicht arbeitet; eine archivierte Sitzung oder eine schreibgeschützte Workbench lehnt es ab. Der Dialog zeigt das Ergebnis, zum Beispiel „Verlauf zusammengefasst.“

## Befehlszeile

`vera run` akzeptiert die Sitzungseinstellungen für einen Lauf: `--advanced toolCallsPerTurn=100`, `--advanced noOutputTimeout=900` oder `--advanced autoCompaction=off`. Ein Schalter nimmt `on`, `off`, `true` oder `false`. Diese Werte gelten nur für diesen Lauf und werden nicht in der Sitzung gespeichert. Wiederholen Sie die Option für mehrere Einstellungen. Eine unbekannte Einstellung, eine Einstellung, die keine Sitzungseinstellung ist, oder ein Wert außerhalb des Bereichs endet mit einem Nutzungsfehler.
