# Dokumente und Suche

VERA indiziert die Dokumentation einer Workbench auf Ihrem Computer, damit der Agent sie durchsuchen und genau die Seite, den Abschnitt oder die Zeile angeben kann, die er verwendet hat. Die Indizierung verwendet ein lokales Modell und sendet nichts über das Netzwerk. Liest der Agent eine Textstelle, um Ihnen zu antworten, geht diese Textstelle wie der Rest der Unterhaltung an Ihren Modellanbieter; mit einem lokalen Server wie LM Studio oder Ollama bleibt sie auf Ihrem Computer.

Die Anzeigemaskierung ist standardmäßig ausgeschaltet. Wenn sie für eine Workbench aktiviert ist, erscheinen gespeicherte Geheimnisse in Dateinamen und im Viewer-Text als [REDACTED]. Dateien und Suchtreffer bleiben aufgelistet und öffnen dieselbe Datei, auch wenn zwei maskierte Namen gleich aussehen. Dies ändert weder die Indizierung noch die Daten, die der Agent an ein Modell senden darf. PDF-Seitenbilder behalten ihre ursprünglichen Bytes; nur extrahierter Text wird maskiert.

## Was indiziert wird

Indiziert werden die Ordner, die unter **Workbench bearbeiten** → **Dokumente & RAG** ausgewählt sind, zusammen mit den Ein- und Ausschlussmustern unter **Erweitert: Einschluss- und Ausschlussmuster**. Diese Dateitypen werden indiziert:

- PDF
- Markdown, HTML und Text (`.txt`, `.csv`, `.tsv`)
- Word-, PowerPoint- und Excel-Dateien in den modernen Formaten (`.docx`, `.pptx`, `.xlsx`) und ihre OpenDocument-Entsprechungen (`.odt`, `.odp`, `.ods`)

Ältere `.doc`-, `.ppt`-, `.xls`- und RTF-Dateien werden nicht indiziert; speichern Sie sie in einem modernen Format. Dateien, auf die `.vera/.veraignore` zutrifft, und alles in `.vera`, `.git` oder `node_modules` werden nie indiziert. Auch Quellcode und Protokolle werden nicht indiziert; der Agent liest sie direkt mit seinen Dateiwerkzeugen.

Ist **.gitignore verwenden** aktiviert (Standard für neue Workbenches), werden auch Dateien und Ordner nicht indiziert, die die `.gitignore`-Dateien der Workbench ausschließen: die im Workbench-Ordner und die in seinen Unterordnern, jede für ihren eigenen Ordner, wie in Git. Eine Zeile, die in `.vera/.veraignore` mit `!` beginnt, holt eine Datei oder einen Ordner zurück, den `.gitignore` ausschließt, mit allem darin; `.vera`, `.git` und `node_modules` bleiben ignoriert. Die Dateiwerkzeuge des Agenten lesen Dateien, die nur `.gitignore` ausschließt, weiterhin.

Die Indizierung läuft im Hintergrund und folgt Änderungen: Neue, geänderte und gelöschte Dateien werden automatisch erfasst.

## Indexstatus

Der Tab **Dateien** im rechten Bereich zeigt den Fortschritt (**Index: … fertig, … ausstehend, … fehlgeschlagen**) und kennzeichnet jedes Dokument:

| Status | Bedeutung |
|---|---|
| **Indiziert** | Durchsuchbar |
| **Ausstehend** | Wartet auf die Indizierung |
| **Fehlgeschlagen** | Konnte nicht gelesen oder verarbeitet werden; der Grund wird angezeigt, zum Beispiel **Größenlimit überschritten** |
| **Nicht unterstützt** | Kein unterstützter Typ oder größer als das Größenlimit (**Größenlimit überschritten**) |
| **OCR erforderlich** | Ein gescanntes PDF ohne Textebene; VERA führt keine OCR aus |

PDF- und Office-Dateien bis 100 MiB und Textdateien bis 20 MiB werden indiziert. **Maximale Dateigröße (MB)** unter **Workbench bearbeiten** → **Dokumente & RAG** senkt diese Limits für die Workbench (1 MB = 1.048.576 Bytes); sie erhöht sie nie. Lassen Sie das Feld leer, um sie beizubehalten. **Neu indizieren** indiziert die Workbench erneut. Wurde die Indizierung nach wiederholten Fehlern angehalten, wählen Sie **Indexierung neu starten**.

**Maximale Anzahl indizierter Dateien** unter **Workbench bearbeiten** → **Dokumente & RAG** (standardmäßig 10.000) schützt vor einer unerwartet großen Auswahl. Sind mehr Dokumente ausgewählt, startet die Indizierung nicht: Der Tab **Dateien** zeigt die Anzahl, die zehn Ordner mit den meisten ausgewählten Dokumenten (Unterordner eingeschlossen), **Trotzdem indexieren** und **Ausschlüsse bearbeiten**. Währenddessen wird nichts indiziert, geändert oder entfernt, und die Indizierung nimmt nie nur einen Teil der Auswahl. **Trotzdem indexieren** indiziert alle und merkt sich die Anzahl; eine spätere Auswahl, die bis zu 20 % größer ist, wird weiter indiziert, eine größere hält wieder an. **Ausschlüsse bearbeiten** öffnet **Dokumente & RAG**, um die Auswahl einzugrenzen.

Die Dokumentanzahl in **Neue Workbench** und **Dokumente & RAG** wird nach denselben Regeln wie die Indizierung gezählt (Ignore-Dateien, Dateigrößen- und Dateianzahl-Limit) und entspricht damit dem, was indiziert wird. Liegt die Auswahl über **Maximale Anzahl indizierter Dateien**, erscheint die Warnung dort schon vor dem Speichern. Bei einem sehr großen Ordner endet die Zählung nach 5 Sekunden; die Anzahl lautet dann „mindestens“.

Unter **Workbench bearbeiten** → **Indizierung** legt **Dokumentsuche** die Standardwerte des Agenten fest: **Ergebnisse pro Suche (1–20)** und **Suchmodus**: **Hybrid (Schlüsselwörter und Bedeutung)**, **Nur Schlüsselwörter** oder **Nur Bedeutung**.

## Der Tab Dateien

Der Tab **Dateien** zeigt den gesamten Workbench-Ordner als Baum. Von VERA ignorierte Dateien werden kursiv dargestellt. Das Feld **Dateien und Dokumente suchen** filtert den Baum nach Dateinamen und listet unter **In Dokumenten** passende Textstellen aus indizierten Dokumenten auf.

Das Menü einer Datei bietet **Öffnen**, **Als Kontext anhängen**, **Öffnen in** (die Standard-App oder eine andere App), **Im Explorer anzeigen** (Finder bzw. Ordner auf anderen Systemen), **Kopieren** (absoluter Pfad, relativer Pfad oder Dateiname) und **Eigenschaften**, einschließlich des Indexstatus.

## Quellenverweise

In einer Antwort nennt jeder Quellen-Chip die Quelle und die Stelle: Seite, Seitenbereich, Folie, Überschrift oder Zeilenbereich. Wählen Sie einen Chip, um das Dokument an dieser Stelle zu öffnen. Ein Chip mit der Markierung **Quellenverweis konnte nicht überprüft werden** verweist auf etwas, das VERA nicht bestätigen konnte, zum Beispiel eine Seite, die es nicht gibt, oder eine Datei, die sich inzwischen geändert hat; behandeln Sie diese Aussage mit Vorsicht.

## Der Dokumentbetrachter

Dokumente öffnen sich als Tabs neben dem Tab **Chat**, sodass die Unterhaltung an ihrer Stelle bleibt. Sie können frei zwischen ihnen wechseln.

- PDF-Dateien scrollen fortlaufend und zeigen die Seitenzahl. Zoomen Sie mit Ctrl+Mausrad oder mit Ctrl+= , Ctrl+- und Ctrl+0.
- Ctrl+F sucht Text in einem PDF- oder Textdokument; in Textdateien springt Ctrl+G zu einer Zeile.
- Ctrl+Tab und Ctrl+Shift+Tab wechseln zwischen Tabs, Ctrl+W schließt den aktuellen Tab, und Escape kehrt zu **Chat** zurück.
- Das Menü eines Tabs bietet **Schließen**, **Andere schließen**, **Rechts schließen**, **Nach links verschieben** und **Nach rechts verschieben**. Tabs lassen sich auch ziehen.

## Downloads

Ist **Webzugriff** aktiviert, kann der Agent eine öffentliche Datei in `.vera/downloads/` der Workbench herunterladen. In **Nachfragen** und **Auto-Edit** fragt er zuerst nach und zeigt die Quelladresse und die maximale Größe. Ein heruntergeladenes PDF erhält in der Unterhaltung eine Karte **PDF öffnen** und erscheint im Tab **Dateien** unter **Heruntergeladene Dateien**. Downloads werden nicht automatisch indiziert; um einen Download durchsuchbar zu machen, kopieren Sie ihn in einen indizierten Ordner. Zum Webzugriff siehe [Einstellungen](settings.md), zu Freigaben [Berechtigungen](permissions.md).
