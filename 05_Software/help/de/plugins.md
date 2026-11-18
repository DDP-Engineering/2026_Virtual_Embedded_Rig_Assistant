# Plugins

Mit Plugins steuert der Agent die Werkzeuge an Ihrem Laborplatz: Flash- und Debug-Werkzeuge, serielle Monitore, Busanalysatoren, Simulatoren, Messgeräte. Ein Plugin deklariert seine Programme, wie VERA sie installiert, die Risikostufe jedes Befehls und Skills, die dem Agenten deren Verwendung beibringen. Jedes installierte Plugin hat eine eigene Hilfeseite in der Hilfe und auf seiner Karte.

## Ein Plugin finden und installieren

1. Wählen Sie auf der Seite **Plugins** die Option **Verfügbare Plugins entdecken**. Filtern Sie nach **Ökosystem**, **Tätigkeit**, **Herkunft**, **Reife** oder Zustand, oder suchen Sie.
2. Öffnen Sie **Details**, um zu sehen, was das Plugin benötigt, einschließlich erforderlicher Plugins und Programme.
3. Wählen Sie **Installieren** oder **Mit Abhängigkeiten installieren**, um auch die erforderlichen Plugins und die Programme zu installieren, die VERA selbst installieren kann.
4. Prüfen Sie die Übersicht und bestätigen Sie.

Eine Karte warnt, wenn das Plugin für Ihre Plattform nicht verfügbar ist oder auf ein Gerät schreiben bzw. es dauerhaft verändern kann. Versionen unter 1.0.0 sind als **Vorabversion** gekennzeichnet.

## Ein Paket installieren

**Paket installieren** installiert die Plugins eines Ökosystems, etwa ESP32, STM32 oder Electronics design. Wählen Sie die benötigten Gruppen aus, wählen Sie **Paket prüfen** und dann **Mit Abhängigkeiten installieren**. Bereits installierte oder für Ihre Plattform nicht verfügbare Plugins werden ausgelassen.

## Prüfung und Vertrauen

Vor der Installation zeigt VERA eine Prüfübersicht: was das Plugin enthält (**Programme** und ihre Herkunft, **Skills**, **Profile und Datendateien**, **Dokumente**), und die **Operationen**, also die Befehlsregeln des Plugins, gruppiert nach Risikostufe. Updates, die Programme, Quellen oder Regeln ändern, werden erneut geprüft. Ändern sich die Dateien des Plugins nach der Installation, verwendet VERA es nicht mehr, bis Sie es erneut installieren.

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

## Abhängigkeiten

Der Block **Status** eines installierten Plugins prüft zwei Dinge: **Abhängigkeiten** und **Konfiguration**. Er zeigt **Bereit** nur, wenn beide bereit sind.

- **Abhängigkeiten prüfen** sucht nach den Programmen; **Alle Abhängigkeiten prüfen** tut dies für jedes Plugin.
- **Abhängigkeiten installieren** installiert, was VERA selbst installieren kann (Python-Pakete, Skripte und Downloads mit fester Version), in seinen eigenen Programmordner. Jeder Download wird anhand seines SHA-256 geprüft.
- Herstellerprogramme wie KiCad, LTspice oder STM32CubeProgrammer sind **Extern verwaltet**: Installieren Sie sie mithilfe der **Installationsanleitung** und prüfen Sie dann erneut.
- **Neu installieren** lädt die Programmkopien von VERA erneut herunter und ersetzt sie.
- **Aus Abhängigkeitsarchiv installieren…** installiert ein Programm aus einem Archiv, das Sie selbst heruntergeladen haben; VERA prüft es anhand des SHA-256 des Plugins.

## Parameter

Manche Plugins benötigen Einstellungen, die mit **Einrichtung erforderlich** gekennzeichnet sind und in ihrem Abschnitt **Konfiguration** eingetragen werden: zum Beispiel Zugangsdaten für MQTT-Broker, Wokwi-Tokens, Lieferantenschlüssel für die Bauteilsuche oder eine Workbench-Datei wie eine Liste der Ressourcen des Laborplatzes. Geheimnisse gehen nur an einen freigegebenen Lauf dieses Plugins; der Agent sieht sie nie.

## Programmläufe

Jeder Befehl, den der Agent ausführt, durchläuft Ihren Berechtigungsmodus (siehe [Berechtigungen](permissions.md)). Der Tab **Läufe** im rechten Bereich listet die Läufe des Workbenchs auf; **Protokoll öffnen** zeigt die Ausgabe, und **Stoppen** beendet ein laufendes Programm. Protokolle werden in `.vera/runs/` aufbewahrt.

## Updates und der Katalog

**Nach Updates suchen** sucht nach neuen Plugin-Versionen; ein Update zeigt **Auf … aktualisieren**. VERA prüft außerdem einmal täglich, sofern Aktualisierungen nicht in den [Einstellungen](settings.md) ausgeschaltet sind. Unter **Katalogeinstellungen** wählen Sie den **Kanal** (**Stabil** oder **Vorabversion**) und optional eine **Katalog-URL**, zum Beispiel den Spiegel Ihres Unternehmens. VERA verwendet einen Katalog nur, wenn seine Signatur übereinstimmt; andernfalls zeigt es die mit VERA ausgelieferten Plugins.

**Deinstallieren** und **Zip exportieren** befinden sich unter **Weitere Aktionen** auf der Karte eines installierten Plugins. Ohne Netzwerk siehe [Offline-Installation](offline-install.md).
