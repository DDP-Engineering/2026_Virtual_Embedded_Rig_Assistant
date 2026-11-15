# Arduino CLI

Arduino CLI baut und lädt native Arduino-Sketches (`.ino`-Projekte) mit einer festgelegten Version von arduino-cli hoch, ohne die Arduino IDE. Der Agent untersucht einen Sketch, listet angeschlossene Boards nach ihrer Identität auf, sucht und installiert Cores und Bibliotheken in exakten Versionen, kompiliert eine Kopie des Sketches in einen nachvollziehbaren Laufordner und lädt genau dieses geprüfte Binary auf ein identifiziertes Board hoch. Alles läuft in VERAs eigener Arduino-Umgebung (`~/.vera-arduino`, unter Windows `%USERPROFILE%\.vera-arduino`); die Ordner der Arduino IDE werden nie gelesen oder verändert. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **arduino-cli** 1.6.0: Auf der Plugin-Seite lädt **Abhängigkeiten installieren** es herunter und prüft seine SHA-256. Ein arduino-cli 1.6 oder neuer (unter 2), das Sie selbst von https://arduino.github.io/arduino-cli/latest/installation/ installiert haben, wird im PATH gefunden; der festgelegte Download wird bevorzugt.
- **arduino-tool**: ein Skript im Plugin, das automatisch installiert wird.
- Das Plugin **serial-monitor**, das nach einem Upload die Konsole des Boards liest. **Mit Abhängigkeiten installieren** fügt es hinzu.
- Ein per USB angeschlossenes Arduino-Board. Unter Linux muss Ihr Benutzer in der Gruppe sein, der die seriellen Ports gehören (`dialout` unter Debian, Ubuntu und Fedora).
- Keine Konfigurationsparameter.

## Verwendung

- „Kompilieren Sie den Blink-Sketch für einen Arduino Uno und nennen Sie die Flash- und RAM-Belegung.“ (Skill `arduino-build-fix`)
- „Beim Kompilieren fehlt Adafruit_BME280.h. Suchen und installieren Sie die richtige Bibliothek.“ (Skill `arduino-libraries`)
- „Welche Boards sind angeschlossen?“
- „Schreiben Sie einen kleinen Sketch, der die Messwerte des BME280 ausgibt, laden Sie ihn auf den Uno an COM5 hoch und zeigen Sie mir das Banner.“ (Skill `arduino-test-sketch`)

Der Agent fragt Sie, welches Board und welchen Port er verwenden soll, wenn mehr als eines angeschlossen ist oder das Board hinter einem USB-Bridge-Chip (CH340, FTDI, CP210x) sitzt. Vor der Installation eines Cores oder einer Bibliothek fragt er nach, weil das ein Download ist. Nach einem Upload liest er das Boot-Banner mit dem Serial Monitor.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Untersuchen eines Sketches, Abfragen zu Boards, Cores und Bibliotheken, Laufberichte und das Leeren von VERAs Build-Cache.
- Gerät lesen: Auflisten der Boards (serielle Ports und mDNS-Erkennung) und Kompilieren, das den Compiler und die Build-Hooks des Cores auf diesem Computer ausführt.
- Gerät schreiben: Installieren von Cores, Bibliotheken und Indizes in VERAs Arduino-Umgebung sowie Hochladen, das den Flash des Boards beschreibt und die neue Firmware sofort startet. Mit einem Programmer überschreibt ein Upload auch den Bootloader.
- Gesperrt: jeder direkte `arduino-cli`-Befehl.

Im Modus Nachfragen fragt VERA vor jedem Befehl der Stufen Gerät lesen und Gerät schreiben nach; Auto-Edit führt Befehle der Stufe Gerät lesen ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64.
- Kein Daemon, kein interaktiver Monitor, kein Brennen des Bootloaders, keine Fuses und kein OTA-Upload.
- Eine `sketch.yaml` wird gemeldet und ignoriert. Bibliotheksabhängigkeiten werden nicht automatisch installiert; jede wird explizit in einer exakten Version installiert.
