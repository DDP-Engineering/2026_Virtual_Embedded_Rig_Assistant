# Plugins

Mit Plugins steuert der Agent die Werkzeuge an Ihrem Laborplatz: Flash- und Debug-Werkzeuge, serielle Monitore, Busanalysatoren, Simulatoren, Messgeräte. Ein Plugin deklariert seine Programme, wie VERA sie installiert, die Risikostufe jedes Befehls und Skills, die dem Agenten deren Verwendung beibringen. Öffnen Sie auf der Plugin-Karte **Details → Hilfe**, um die Anleitung zu lesen.

## Ein Plugin finden und installieren

1. Wählen Sie auf der Seite **Plugins** die Option **Verfügbare Plugins entdecken**. Filtern Sie nach **Ökosystem**, **Tätigkeit**, **Herkunft**, **Reife**, **Voraussetzungen** oder Zustand, oder suchen Sie. **Voraussetzungen** zeigt nur Plugins mit allen angehakten Voraussetzungen: **Nur Skills** (ohne Programme), **Python-Skript**, **Von VERA geladenes Programm**, **Selbst installiertes Programm** und **Einstellungen**.
2. Öffnen Sie **Details**, um zu sehen, was das Plugin benötigt, einschließlich erforderlicher Plugins und Programme.
3. Wählen Sie **Installieren** oder **Mit Abhängigkeiten installieren**, um auch die erforderlichen Plugins und die Programme zu installieren, die VERA selbst installieren kann.
4. Erscheint eine Bestätigung, prüfen Sie Quelle, Abhängigkeiten und Risiken und bestätigen Sie.

Eine Karte warnt, wenn das Plugin für Ihre Plattform nicht verfügbar ist oder auf ein Gerät schreiben bzw. es dauerhaft verändern kann. Versionen unter 1.0.0 sind als **Vorabversion** gekennzeichnet. Jede Karte zeigt außerdem die Voraussetzungen des Plugins mit denselben Bezeichnungen.

## Ein Paket installieren

**Paket installieren** installiert die Plugins eines Ökosystems, etwa ESP32, STM32 oder Electronics design. Wählen Sie die benötigten Gruppen aus, wählen Sie **Paket prüfen** und dann **Mit Abhängigkeiten installieren**. Bereits installierte oder für Ihre Plattform nicht verfügbare Plugins werden ausgelassen.

## Prüfung und Vertrauen

Offizielle Pakete aus dem geprüften Katalog werden direkt installiert, wenn sie nur Skills und Markdown-Dokumentation enthalten und keine Abhängigkeiten oder Einstellungen deklarieren. Falls eine Prüfung erforderlich ist, erscheint die Bestätigung über der Bibliothek. **Details** zeigt den vollständigen Inhalt und die SHA-256-Prüfsumme. Bei Updates stehen Änderungen an Programmen und Befehlsregeln als Vorher-Nachher-Werte bereit. VERA prüft das Paket in beiden Fällen. Werden installierte Dateien geändert, verwendet VERA das Plugin erst nach einer Neuinstallation wieder.

Plugins haben eine Vertrauensstufe:

| Stufe | Herkunft |
|---|---|
| **Offiziell** | Aus dem Katalog, dort als offiziell gekennzeichnet |
| **Community** | Jedes andere Plugin aus dem Katalog |
| **Lokal** | Von Ihnen mit **Aus Ordner installieren…** oder **Aus ZIP installieren…** installiert |
| **Test** | Vom Agenten in einer Sitzung entworfen; jeder Befehl fragt nach einer Freigabe, auch in Bypass. **Als lokal einstufen** vertraut ihm |

Ein Workbench kann auch Plugin-Pakete in `.vera/plugins/` mitbringen. Sie werden erst verwendet, nachdem Sie **Workbench-Plugin prüfen** und **Diesem Paket vertrauen** gewählt haben; das Vertrauen wird nur auf diesem Computer gespeichert, und jede Änderung am Paket erfordert eine neue Prüfung.

## Ein Plugin für einen Workbench aktivieren

Durch die Installation wird ein Plugin nicht aktiviert. Öffnen Sie **Workbench bearbeiten** → **Plugins**, wählen Sie das Plugin aus und wählen Sie **Speichern**. Nur aktivierte Plugins werden dem Agenten in diesem Workbench angeboten.

## Werkzeuge und Plugin-Funktionen

**Werkzeuge** enthält allgemeine VERA-Funktionen, darunter `run_program`, `run_command`, `program_output`, `program_stop` und Terminalzugriff. Plugin-Programme einschließlich der eigenen Git-Integration stehen beim Plugin unter **Plugins**. Die Ausführung benötigt weiterhin die allgemeine Werkzeugfreigabe, Befehlsrisikoregeln und Sitzungsberechtigungen.

Öffnen Sie beim Plugin **Details** für die Beschreibung und die **Werkzeuge für den Agenten**. Diese Kontrollkästchen steuern einzelne Werkzeuge unabhängig von der Plugin-Auswahl. `apply_candidate` benötigt das offizielle `kicad-layout`. `parts_search` benötigt das offizielle `parts-search`, Webzugriff und einen Anbieter, den Sie in der **Konfiguration** auf der Plugins-Seite aktivieren. Unter **Programme und Abhängigkeiten** sehen Sie die Programme und können **Abhängigkeiten prüfen** wählen.

**Gemeinsame Elektro- / Automatisierungswerkzeuge** erscheint, sobald ein Elektro- oder Automatisierungspaket installiert ist. Aktiviere ein ladbares Plugin, um diese Werkzeuge zu nutzen. Pluginspezifische Werkzeuge stehen auf den Karten installierter Pakete. Die Freigaben der Workbench bleiben bei einer Deinstallation gespeichert. Bei leerer Liste führt **Verfügbare Plugins entdecken** zum globalen Katalog.

Eine Werkzeugfreigabe installiert oder aktiviert kein Plugin. Plugin-Aktivierung entfernt keine ausdrückliche Werkzeugeinschränkung. Beide Listen sind Entwürfe bis **Speichern**; **Abbrechen** verwirft beide. Einschränkungen bleiben beim erneuten Öffnen bestehen; schreibgeschützte Sitzungen blenden Schreib- und Ausführungswerkzeuge weiterhin aus. Erreichen Sie Kontrollkästchen mit Tab und schalten Sie mit der Leertaste; Eingabe oder Leertaste öffnet Gruppen.

## Abhängigkeiten

Der Block **Status** eines installierten Plugins zeigt die zutreffenden Prüfungen. Er zeigt **Bereit**, wenn alle zutreffenden Prüfungen abgeschlossen sind.

- **Abhängigkeiten prüfen** erscheint bei Plugins, die Programme deklarieren. **Alle Abhängigkeiten prüfen** prüft alle installierten Plugins.
- **Abhängigkeiten installieren** installiert, was VERA selbst installieren kann (Python-Pakete, Skripte und Downloads mit fester Version), in seinen eigenen Programmordner. Jeder Download wird anhand seines SHA-256 geprüft.
- Herstellerprogramme wie KiCad, LTspice oder STM32CubeProgrammer sind **Extern verwaltet**: Installieren Sie sie mithilfe der **Installationsanleitung** und prüfen Sie dann erneut.
- **Weitere Aktionen → Neu installieren** lädt die Programmkopien von VERA erneut herunter und ersetzt sie.
- **Aus Abhängigkeitsarchiv installieren…** installiert ein Programm aus einem Archiv, das Sie selbst heruntergeladen haben; VERA prüft es anhand des SHA-256 des Plugins.

## Parameter

Manche Plugins benötigen Einstellungen, die mit **Einrichtung erforderlich** gekennzeichnet sind und in ihrem Abschnitt **Konfiguration** eingetragen werden: zum Beispiel Zugangsdaten für MQTT-Broker, Wokwi-Tokens, Lieferantenschlüssel für die Bauteilsuche oder eine Workbench-Datei wie eine Liste der Ressourcen des Laborplatzes. Geheimnisse gehen nur an einen freigegebenen Lauf dieses Plugins; der Agent sieht sie nie.

## Programmläufe

Jeder Befehl, den der Agent ausführt, durchläuft Ihren Berechtigungsmodus (siehe [Berechtigungen](permissions.md)). Der Tab **Läufe** im rechten Bereich listet die Läufe des Workbenchs auf; **Protokoll öffnen** zeigt die Ausgabe, und **Stoppen** beendet ein laufendes Programm. Protokolle werden in `.vera/runs/` aufbewahrt.

## Updates und der Katalog

**Nach Updates suchen** sucht nach neuen Plugin-Versionen; ein Update zeigt **Auf … aktualisieren**. VERA prüft außerdem einmal täglich oder im **Intervall der Plugin-Katalogprüfung** aus den [erweiterten Einstellungen](advanced-settings.md), sofern Aktualisierungen nicht in den [Einstellungen](settings.md) ausgeschaltet sind. Unter **Katalogeinstellungen** wählen Sie den **Kanal** (**Stabil** oder **Vorabversion**) und optional eine **Katalog-URL**, zum Beispiel den Spiegel Ihres Unternehmens. VERA verwendet einen Katalog nur, wenn seine Signatur übereinstimmt; andernfalls zeigt es die mit VERA ausgelieferten Plugins.

**Deinstallieren** und **Zip exportieren** befinden sich unter **Weitere Aktionen** auf der Karte eines installierten Plugins. Ohne Netzwerk siehe [Offline-Installation](offline-install.md).
