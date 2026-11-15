# MicroPython

Dieses Plugin ermöglicht dem Agenten, mit einem Board zu arbeiten, auf dem bereits MicroPython 1.22 oder neuer läuft. Es listet serielle Ports auf, identifiziert die Firmware des Boards, listet und liest seine Dateien, überträgt eine Workbench-Datei über eine geprüfte temporäre Kopie, führt ein Workbench-Skript mit einer Frist und einem Bestanden/Nicht-bestanden-Urteil aus dem RAM aus, zeichnet die Konsole auf und setzt das Board zurück. Es gibt keinen interaktiven REPL und keine Firmware-Installation. Die Ergebnisse landen unter `arduino-iot-results/`.

## Voraussetzungen

- **micropython-tool**, ein Python-Skript im Plugin mit einer festgelegten Version von mpremote, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- Ein über USB-Seriell angeschlossenes Board, auf dem bereits MicroPython 1.22 oder neuer läuft. Andere Firmware, auch CircuitPython, wird abgelehnt. Um MicroPython zu installieren, verwenden Sie zuerst das Werkzeug des Board-Herstellers (zum Beispiel esptool für einen ESP32).
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `micropython-deploy` und `micropython-test-script`. Er benennt das Board über seinen Port und die Identität, die die Portliste zeigt, und fragt Sie, welches Board hinter einer USB-Seriell-Bridge sitzt.

- „Listen Sie die seriellen Ports auf und identifizieren Sie das MicroPython-Board an COM5.“
- „Zeigen Sie die Dateien in /lib auf dem Board und den freien Speicher.“
- „Übertragen Sie app/sensor.py nach /lib/sensor.py auf dem Board und starten Sie es dann neu.“
- „Schreiben Sie ein Skript, das den I2C-Bus scannt, führen Sie es mit einem Zeitlimit von 30 Sekunden auf dem Board aus und nennen Sie mir das Urteil.“
- „Zeichnen Sie nach einem Neustart 10 Sekunden lang die Konsole des Boards auf.“

## Risiko und Freigaben

Fast jede Board-Operation unterbricht das Programm, das auf dem Board läuft (Strg+C), daher sagt der Agent das vorher; mit `--restart` startet das Programm danach wieder.

- **Sicher** (läuft ohne Rückfrage): Auflisten von Ports, ohne sie zu öffnen, und Zusammenfassen von Laufordnern.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Identifizieren des Boards, Auflisten und Lesen von Dateien, Aufzeichnen der Konsole und Zurücksetzen des Boards, wodurch das gespeicherte Programm erneut startet.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Übertragen einer Datei und Ausführen eines Skripts aus dem RAM. Die Freigabe ist an den Hash der Datei gebunden. Ein Skript kann die Pins des Boards und alles daran Angeschlossene ansteuern.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Ersetzen von boot.py oder main.py, die bei jedem Start laufen; eine fehlerhafte Datei kann den REPL aussperren, bis die Firmware neu installiert wird. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

## Grenzen

- Windows x64 und Linux x64.
- Es gibt keine Sicherung oder Wiederherstellung der Dateien des Boards.
- Stoppen beendet nur das Hilfsprogramm auf Ihrem Computer; bereits auf dem Board laufender Code läuft weiter.
- VERA reserviert den seriellen Port für den Lauf.
