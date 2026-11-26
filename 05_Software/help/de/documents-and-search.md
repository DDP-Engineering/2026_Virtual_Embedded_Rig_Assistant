# Dokumente und Suche

VERA indiziert die Dokumentation eines Workbenchs auf Ihrem Computer, damit der Agent sie durchsuchen und genau die Seite, den Abschnitt oder die Zeile angeben kann, die er verwendet hat. Indizierung und semantische Suche verwenden das lokale Modell des Workbenchs. BGE Small EN v1.5 ist das Standardmodell für Englisch. Ein Workbench mit Multilingual E5 Small findet passende Textstellen auf Rumänisch, Deutsch, Französisch und in weiteren Sprachen, auch bei einer Anfrage in einer anderen Sprache. Die Pakete für Windows und Linux enthalten beide Modelle. Mit beiden können Sie direkt nach der Installation offline indizieren. Liest der Agent eine Textstelle, um Ihnen zu antworten, geht diese Textstelle wie der Rest der Unterhaltung an Ihren Modellanbieter; mit einem lokalen Server wie LM Studio oder Ollama bleibt sie auf Ihrem Computer.

Öffnen Sie **Workbench bearbeiten** → **Indizierung**, wählen Sie das Modell und speichern Sie. VERA zeigt die Anzahl der indizierten Dokumente an und bittet um Bestätigung. Danach erstellt VERA die Vektoren des Workbenchs im Hintergrund neu und behält den extrahierten Text. Die Stichwortsuche bleibt währenddessen verfügbar. Wenn während der Bestätigung weitere Dokumente fertig indiziert werden, können Sie den Wechsel weiterhin bestätigen.

Die Anzeigemaskierung ist standardmäßig ausgeschaltet. Wenn sie für einen Workbench aktiviert ist, erscheinen gespeicherte Geheimnisse in Dateinamen und im Viewer-Text als [REDACTED]. Dateien und Suchtreffer bleiben aufgelistet und öffnen dieselbe Datei, auch wenn zwei maskierte Namen gleich aussehen. Dies ändert weder die Indizierung noch die Daten, die der Agent an ein Modell senden darf. PDF-Seitenbilder behalten ihre ursprünglichen Bytes; nur extrahierter Text wird maskiert.

## Was indiziert wird

Indiziert werden die Ordner, die unter **Workbench bearbeiten** → **Dokumente & RAG** ausgewählt sind, zusammen mit den Ein- und Ausschlussmustern unter **Erweitert: Einschluss- und Ausschlussmuster**. Diese Dateitypen werden indiziert:

- PDF
- Markdown, HTML und Text (`.txt`, `.csv`, `.tsv`)
- Word-, PowerPoint- und Excel-Dateien in den modernen Formaten (`.docx`, `.pptx`, `.xlsx`) und ihre OpenDocument-Entsprechungen (`.odt`, `.odp`, `.ods`)

Ältere `.doc`-, `.ppt`-, `.xls`- und RTF-Dateien werden nicht indiziert; speichern Sie sie in einem modernen Format. Dateien, auf die `.vera/.veraignore` zutrifft, und alles in `.vera`, `.git` oder `node_modules` werden nie indiziert. Auch Quellcode und Protokolle werden nicht indiziert; der Agent liest sie direkt mit seinen Dateiwerkzeugen.

Ist **.gitignore verwenden** aktiviert (Standard für neue Workbenches), werden auch Dateien und Ordner nicht indiziert, die die `.gitignore`-Dateien des Workbenchs ausschließen: die im Workbench-Ordner und die in seinen Unterordnern, jede für ihren eigenen Ordner, wie in Git. Eine Zeile, die in `.vera/.veraignore` mit `!` beginnt, holt eine Datei oder einen Ordner zurück, den `.gitignore` ausschließt, mit allem darin; `.vera`, `.git` und `node_modules` bleiben ignoriert. Die Dateiwerkzeuge des Agenten lesen Dateien, die nur `.gitignore` ausschließt, weiterhin.

Die Textextraktion erkennt UTF-8 und UTF-16 mit Byte Order Mark (BOM). Schlägt die UTF-8-Dekodierung einer als Text erkannten Datei fehl, verwendet VERA Windows-1252.

Die Indizierung läuft im Hintergrund und folgt Änderungen: Neue, geänderte und gelöschte Dateien werden automatisch erfasst.

## Indexstatus

Der Tab **Dateien** zeigt die Symbolschaltflächen **Neu indizieren** und **Alle einklappen** neben der Suche. Beim Darüberfahren erscheint ihre Beschriftung. Während der Indexierung zeigt eine kompakte Zeile fertige und verbleibende Dateien; nach erfolgreichem Abschluss verschwindet sie. Der Tooltip der Neuindizierung zeigt weiterhin Dokument- und Fehleranzahl. Klappen Sie die Fehleranzahl für Dateinamen und Gründe auf und wählen Sie **Neu indizieren**, um die gesamte Auswahl erneut zu verarbeiten. Fehler bleiben beim erneuten Öffnen sichtbar. Jedes Dokument hat außerdem einen eigenen Status:

| Status | Bedeutung |
|---|---|
| **Indiziert** | Durchsuchbar |
| **Ausstehend** | Wartet auf die Indizierung |
| **Fehlgeschlagen** | Konnte nicht gelesen oder verarbeitet werden; der Grund wird angezeigt, zum Beispiel **Größenlimit überschritten** |
| **Nicht unterstützt** | Kein unterstützter Typ oder größer als das Größenlimit (**Größenlimit überschritten**) |
| **OCR erforderlich** | Ein gescanntes PDF ohne Textebene; VERA führt keine OCR aus |

PDF- und Office-Dateien bis 100 MiB und Textdateien bis 20 MiB werden indiziert. **Maximale Dateigröße (MB)** unter **Workbench bearbeiten** → **Dokumente & RAG** legt das Limit für PDF und Office des Workbench fest, höher oder niedriger, bis 500 MB (1 MB = 1.048.576 Bytes); lassen Sie das Feld leer für 100 MiB. Das Textlimit ist die erweiterte Einstellung **Maximale Textdateigröße** (siehe [Erweiterte Einstellungen](advanced-settings.md)). **Neu indizieren** indiziert den Workbench erneut. Wurde die Indizierung nach wiederholten Fehlern angehalten, wählen Sie **Indexierung neu starten**.

**Maximale Anzahl indizierter Dateien** unter **Workbench bearbeiten** → **Dokumente & RAG** (standardmäßig 10.000) schützt vor einer unerwartet großen Auswahl. Sind mehr Dokumente ausgewählt, startet die Indizierung nicht: Der Tab **Dateien** zeigt die Anzahl, die zehn Ordner mit den meisten ausgewählten Dokumenten (Unterordner eingeschlossen), **Trotzdem indexieren** und **Ausschlüsse bearbeiten**. Währenddessen wird nichts indiziert, geändert oder entfernt, und die Indizierung nimmt nie nur einen Teil der Auswahl. **Trotzdem indexieren** indiziert alle und merkt sich die Anzahl; eine spätere Auswahl, die bis zu 20 % größer ist, wird weiter indiziert, eine größere hält wieder an. **Ausschlüsse bearbeiten** öffnet **Dokumente & RAG**, um die Auswahl einzugrenzen.

Die Dokumentanzahl in **Neuer Workbench** und **Dokumente & RAG** wird nach denselben Regeln wie die Indizierung gezählt (Ignore-Dateien, Dateigrößen- und Dateianzahl-Limit) und entspricht damit dem, was indiziert wird. Liegt die Auswahl über **Maximale Anzahl indizierter Dateien**, erscheint die Warnung dort schon vor dem Speichern. Bei einem sehr großen Ordner endet die Zählung nach 5 Sekunden; die Anzahl lautet dann „mindestens“.

Unter **Workbench bearbeiten** → **Indizierung** legt **Dokumentsuche** die Standardwerte des Agenten fest: **Ergebnisse pro Suche (1–20)** und **Suchmodus**: **Hybrid (Schlüsselwörter und Bedeutung)**, **Nur Schlüsselwörter** oder **Nur Bedeutung**.

## Der Tab Dateien

Der Tab **Dateien** zeigt den gesamten Workbench-Ordner als Baum. Von VERA ignorierte Dateien werden kursiv dargestellt. Das Feld **Dateien und Dokumente suchen** filtert den Baum nach Dateinamen und listet unter **In Dokumenten** passende Textstellen aus indizierten Dokumenten auf. Wechseln Sie zurück zum VERA-Fenster, um nach Änderungen außerhalb der App den Dateibaum und die Suchergebnisse zu aktualisieren.

Das Menü einer Datei bietet **Öffnen**, **Als Kontext anhängen**, **Öffnen in** (die Standard-App oder eine andere App), **Im Explorer anzeigen** (Finder bzw. Ordner auf anderen Systemen), **Kopieren** (absoluter Pfad, relativer Pfad oder Dateiname) und **Eigenschaften**, einschließlich des Indexstatus.

## Git-Status in Dateien

Aktivieren und speichern Sie **Git-Status in Dateien anzeigen** unter **Workbench bearbeiten → Oberfläche**. Die Option ist pro Workbench standardmäßig aus. Dateien zeigt den Branch und zählt geänderte Pfade und Konflikte in der Workbench. Bei einer Umbenennung zählen beide Pfade, wenn sie in der Workbench liegen. Liegt ein Pfad außerhalb, erscheint auf der sichtbaren Seite eine Hinzufügung oder Löschung.

**I** und **A** kennzeichnen Änderungen im Index bzw. im Arbeitsbaum. Die Codes lauten M (geändert), ? (nicht verfolgt), A (hinzugefügt), R (umbenannt), D (gelöscht) und ! (Konflikt). Eine Datei kann beide Markierungen haben. Ein eingeklappter Ordner zeigt die Anzahl geänderter Pfade. **Nur Git-Änderungen** filtert den Baum. Gelöschte Dateien und fehlende Umbenennungsquellen bleiben als Einträge ohne Datei zum Öffnen sichtbar.

Der Status verwendet die Git-Ignore-Regeln auch dann, wenn die Dokumentindizierung anderen Regeln folgt. Änderungen an überwachten Dateien aktualisieren die Anzeige. Verwenden Sie **Git-Status aktualisieren** bei einem Fehler oder für Ordner, die nicht überwacht werden können. Die schreibgeschützte Ansicht benötigt eine Systeminstallation von Git 2.40 oder neuer und einen gewöhnlichen lokalen Arbeitsbaum. Verknüpfte Arbeitsbäume, Submodule als Workbench-Wurzel, nicht unterstützte Metadatenlayouts und Repositorys mit Includes oder Filtern in der Konfiguration melden einen nicht verfügbaren Status. Die Dateiansicht bleibt benutzbar.

Öffnen Sie das Kontextmenü einer geänderten Datei (Rechtsklick oder **Umschalt+F10**) und wählen Sie **Git → Arbeitsbaumänderungen anzeigen** oder **Indexänderungen anzeigen**. Die erste Option vergleicht den Arbeitsbaum mit dem Index. Die zweite vergleicht den Index mit HEAD oder bei einem Branch ohne Commit mit einer leeren Basis. Jeder Vergleich öffnet sich in einem eigenen Tab neben Chat. Wechseln Sie Tabs mit **Strg+Bild auf/ab** und schließen Sie den aktuellen Vergleich mit **Strg+W**. Chatentwurf und Scrollposition bleiben erhalten.

Wählen Sie im Kontextmenü einer verfolgten Datei **Git → Dateiverlauf anzeigen**. Das gilt auch für unveränderte Dateien und verfolgte Löschungen, die unter Dateien erscheinen. Der zentrale Tab zeigt bis zu 50 vom lokalen HEAD erreichbare Commits, beginnend mit dem neuesten, mit Kurz-Hash, Autor, Datum und Betreff. Git verfolgt erkannte Umbenennungen innerhalb der Workbench. Verschiebungen über ihre Grenze hinweg werden ausgelassen. Die Ansicht verwendet lokale Daten und berücksichtigt die Maskierung für die Anzeige.

Die schreibgeschützten Vergleiche sind auch für gelöschte Pfade und Umbenennungen innerhalb der Workbench verfügbar. Ein Hinweis erscheint bei einem Konflikt, einer Binärdatei, einem zu großen Vergleich oder nicht verfügbaren Inhalten. Öffnen Sie nicht verfolgte Dateien in der normalen Dateiansicht.

## Quellenverweise

In einer Antwort nennt jeder Quellen-Chip die Quelle und die Stelle: Seite, Seitenbereich, Folie, Überschrift oder Zeilenbereich. Wählen Sie einen Chip, um das Dokument an dieser Stelle zu öffnen. Ein Chip mit der Markierung **Quellenverweis konnte nicht überprüft werden** verweist auf etwas, das VERA nicht bestätigen konnte, zum Beispiel eine Seite, die es nicht gibt, oder eine Datei, die sich inzwischen geändert hat; behandeln Sie diese Aussage mit Vorsicht.

## Der Dokumentbetrachter

Dokumente öffnen sich als Tabs neben dem Tab **Chat**, sodass die Unterhaltung an ihrer Stelle bleibt. Sie können frei zwischen ihnen wechseln.

Textdateien bieten **Zeichenkodierung** und **Zeilenumbruch**. UTF-8- und UTF-16-BOMs werden erkannt; ohne BOM gilt UTF-8. Bei Bedarf Windows-1252, ISO-8859-1, ISO-8859-2 oder UTF-16 LE/BE wählen. Chromium dekodiert ISO-8859-1 über den Alias Windows-1252. **Als Text anzeigen** zeigt ungültige Bytes als Ersatzzeichen. Suche und Zeilensprung verwenden auch bei Umbruch die ursprünglichen nummerierten Quellzeilen. Diese Steuerelemente ändern weder Datei noch Indexierung oder Zitierprüfung. Bei Anzeigemaskierung ersetzt gewöhnlicher Dateitext geheime Bytes durch Sternchen (UTF-16-Paare erscheinen als ⨪); Namen und gerenderter Zitiertext verwenden [REDACTED].

Große Dateien werden in Fenstern gelesen. Die rechte Bildlaufleiste wählt eine Byteposition; die innere bewegt sich im aktuellen Textfenster. Ctrl+Home/End springt zum Dateianfang/-ende. Zeilennummern mit ≈ sind Schätzungen, bis die fortlaufende Indizierung sie präzisiert. Ein Zeilensprung ist zunächst ungefähr, dann exakt. Die Suche durchsucht Fenster; Enter findet den nächsten, Shift+Enter den vorherigen Treffer. **Abbrechen** stoppt die Suche. Sehr lange Zeilen erscheinen in begrenzten, mit … markierten Abschnitten; beim Scrollen folgt der nächste Abschnitt. Die Suche zählt passende Quellzeilen und setzt am anderen Ende fort. Große Zitate behalten ihren geprüften Bereich.

- PDF-Dateien scrollen fortlaufend und zeigen die Seitenzahl. Zoomen Sie mit Ctrl+Mausrad oder mit Ctrl+= , Ctrl+- und Ctrl+0.
- Ctrl+F sucht in PDF-Dateien ab der aktuellen Seite und funktioniert auch in Textdokumenten. Mit Ctrl+G springen Sie zu einer Seite oder Zeile. PDF-Dateien lassen sich bis auf 400 % vergrößern.
- Ctrl+Tab und Ctrl+Shift+Tab wechseln zwischen Tabs, Ctrl+W schließt den aktuellen Tab, und Escape kehrt zu **Chat** zurück.
- Das Menü eines Tabs bietet **Schließen**, **Andere schließen**, **Rechts schließen**, **Nach links verschieben** und **Nach rechts verschieben**. Tabs lassen sich auch ziehen.

## Downloads

Ist **Webzugriff** aktiviert, kann der Agent eine öffentliche Datei in `.vera/downloads/` des Workbenchs herunterladen. In **Nachfragen** und **Auto-Edit** fragt er zuerst nach und zeigt die Quelladresse und die maximale Größe. Ein heruntergeladenes PDF erhält in der Unterhaltung eine Karte **PDF öffnen** und erscheint im Tab **Dateien** unter **Heruntergeladene Dateien**. Downloads werden nicht automatisch indiziert; um einen Download durchsuchbar zu machen, kopieren Sie ihn in einen indizierten Ordner. Zum Webzugriff siehe [Einstellungen](settings.md), zu Freigaben [Berechtigungen](permissions.md).

## Hex-Ansicht

Im Menü einer Datei unter **Dateien** öffnet **Als Hex anzeigen** die schreibgeschützte Ansicht. Jede Zeile zeigt den physischen Offset, bis zu 16 Hex-Bytes und druckbare ASCII-Zeichen; andere Bytes erscheinen als Punkte. Die letzte Zeile kann kürzer sein. Der Positionsregler erreicht die gesamte Datei, die innere Bildlaufleiste bewegt ein begrenztes Fenster.

**Zu Offset springen** (Ctrl+G) akzeptiert dezimale Bytepositionen oder Hexwerte mit `0x`, von null bis zum letzten Byte. **Suchen** (Ctrl+F) sucht **Hex-Bytes** wie `41 42 00 FF`, mit optionalen Leerzeichen, oder **UTF-8-Text** unter Beachtung der Großschreibung. Eingabe findet den nächsten Treffer und beginnt am Dateiende wieder vorne. Eine Suche umfasst höchstens 4.096 Bytes. **Abbrechen**, Escape oder eine neue Suchanfrage stoppt den Lauf; Escape schließt die Felder und fokussiert die Bytes.

Ein Klick wählt ein Byte; Ziehen oder Shift+Klick erweitert die Auswahl auch über Fenstergrenzen. Pfeile bewegen die Auswahl, Shift+Pfeile erweitern sie, Bild auf/ab bewegt eine Bildschirmhöhe und Ctrl+Pos1/Ende erreicht Anfang/Ende. **Als Hex kopieren** (Ctrl+C) kopiert großgeschriebene Bytes mit Leerzeichen. **Als Text kopieren** (Ctrl+Shift+C) decodiert UTF-8 mit Ersatzzeichen. Pro Auswahl sind höchstens 64 KiB kopierbar; bei Überschreitung einen kleineren Bereich wählen. Die Anzeigemaskierung ersetzt geheime Bytes durch `2A` (Sternchen); Suche und Kopieren verwenden dieselben maskierten Bytes. Lesefehler bieten **Erneut versuchen**.

## Ansichtsmodi

Wählen Sie **Gerendert**, **Text** oder **Hex** in der Dateileiste. Die gerenderte Ansicht ist für indizierte PDF-, Markdown-, HTML- und unterstützte Office-Dateien verfügbar. Nicht indizierte oder ignorierte Markdown- und HTML-Dateien öffnen als Text; binäre Formate ohne verfügbare Darstellung öffnen als Hex. Die gespeicherte Auswahl bleibt dabei erhalten. Binäre und unbekannte Dateien öffnen automatisch in Hex. Für unbekannte Formate lässt sich Text ausdrücklich wählen; Kodierung und Ersatzzeichen bleiben verfügbar. Die Auswahl gilt für dieselbe Dateiendung und bleibt nach einem Neustart von VERA erhalten. Das Öffnen in der Standardanwendung bleibt im Tab-Menü. Zitate behalten ihre geprüfte Ansicht und ihren Bereich; Artefakte, Downloads und Ausführungsprotokolle behalten ihre eigenen Ansichten.

## Bildvorschau

PNG, JPEG, GIF, WebP, BMP und SVG öffnen ohne Indizierung als **Gerendert**. **Bildzoom** beginnt mit **Einpassen**: Große Bilder werden an den verfügbaren Platz angepasst, kleine nicht vergrößert. Einpassen folgt Änderungen der Panelgröße. Wählen Sie 25% bis 400%, um das ursprünglich dekodierte Bild zu skalieren, und kehren Sie dann zu Einpassen zurück. SVG bleibt ein Bild; Skripte, Links und externe Ressourcen sind inaktiv. **Text** und **Hex** bleiben verfügbar; die bewusste Moduswahl wird je Dateiendung gespeichert.

Die Bildbytes folgen der aktuellen Anzeigemaskierung. Maskierung kann die Dekodierung verhindern; auch ungültige oder beschädigte Bilder zeigen einen sicheren Fehler mit **Erneut versuchen**. Hex zeigt die zurückgegebenen Bytes. Die Vorschau setzt begrenzte Bytefenster zu einer vollständigen Browser-Bildressource zusammen. Kodierte und dekodierte Bilder benötigen daher Speicher entsprechend ihrer Größe und unterliegen den Ressourcen des Browserdekoders. Es gibt keine feste Dateigrößengrenze.

## Indizierungsstatus

Das Symbol neben dem Namen der aktiven Workbench zeigt den Stand der Erfassung, Indizierung oder Neuerstellung. Fokussieren Sie das Symbol oder zeigen Sie darauf, um die gemessenen Anzahlen zu sehen. Aktivieren Sie es, um Dateien zu öffnen. Zu den verarbeiteten Dateien zählen auch übersprungene, OCR-pflichtige und fehlgeschlagene Dateien. Durchsuchbare Dokumente haben Textstellen im Index. Während der Erfassung erscheint erst nach Abschluss der Auswahl eine Gesamtzahl. In einer schreibgeschützten Workbench kann VERA den gespeicherten Index ohne erneute Prüfung nutzen. Wählen Sie den Workbench-Namen. Unter **Dokumente und Index** in der Übersicht finden Sie Fortschritt, Anzahlen und Details zu übersprungenen, OCR-pflichtigen und fehlgeschlagenen Dateien. Die Symbolleiste in **Dateien** zeigt die Aktivität. Dateilimit und Neustart bleiben dort verfügbar.

Öffnen Sie die **Workbench-Übersicht**, klappen Sie die Ausnahmen der Indizierung auf und wählen Sie **Erneut versuchen**, um Dateien mit Problemen erneut zu verarbeiten. Erfolgreiche Ergebnisse bleiben erhalten. **Neu indizieren** in **Dateien** verarbeitet die gesamte Auswahl erneut.

Der Chat kennzeichnet Antworten mit teilweiser Dokumentensuche, Stichwortsuche als Ersatz oder nicht verfügbarer Suche. Eine Teilsuche ohne Treffer kann ausstehende oder ausgeschlossene Quellen übersehen. Sie können während der Aktualisierung weiter chatten oder eine bekannte Datei öffnen.
