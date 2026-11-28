# Arduino CLI

Arduino CLI baut und lädt native Arduino-Sketches (`.ino`-Projekte) mit festgelegtem arduino-cli hoch, ohne die Arduino IDE. Der Agent installiert Cores und Bibliotheken, kompiliert einen Sketch, lädt den Build auf Ihr Board und liest, was das Board ausgibt, auf Wunsch in einem Schritt. Alles läuft in VERAs eigener Arduino-Umgebung (`~/.vera-arduino`, unter Windows `%USERPROFILE%\.vera-arduino`); die Ordner der Arduino IDE werden nie gelesen oder verändert. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **arduino-cli** 1.6.0: Auf der Plugin-Seite lädt **Abhängigkeiten installieren** es herunter und prüft seinen SHA-256. Ein selbst installiertes arduino-cli 1.6 oder neuer (unter 2) von https://arduino.github.io/arduino-cli/latest/installation/ wird im PATH gefunden; der festgelegte Download hat Vorrang.
- **arduino-tool**: ein Skript im Plugin, das automatisch installiert wird.
- Das Plugin **serial-monitor**, um die Konsole des Boards länger zu beobachten. **Mit Abhängigkeiten installieren** fügt es hinzu.
- Ein per USB angeschlossenes Arduino-Board. Unter Linux muss Ihr Benutzer in der Gruppe sein, der die seriellen Ports gehören (`dialout` unter Debian, Ubuntu und Fedora).
- Keine Konfigurationsparameter.

## Verwendung

- „Kompilieren Sie den Blink-Sketch für einen Arduino Uno und melden Sie Flash- und RAM-Verbrauch.“ (Skill `arduino-build-fix`)
- „Der Compiler meldet, dass Adafruit_BME280.h fehlt. Installieren Sie die passende Bibliothek.“ (Skill `arduino-libraries`)
- „Schreiben Sie einen kleinen Sketch, der die BME280-Messwerte ausgibt, laden Sie ihn hoch und zeigen Sie mir die Ausgabe.“ (Skill `arduino-test-sketch`)
- „Merken Sie sich, dass dieser Sketch für den Nano an COM7 ist.“
- „Welche Boards sind angeschlossen?“
- „Beginnen Sie mit dem Beispiel-Sketch der BME280-Bibliothek.“
- „Der Sketch passt nicht mehr auf den Uno. Was belegt den meisten Flash?“

Der Agent findet Board und Port selbst, wenn nur eines passt, und fragt Sie, wenn mehrere angeschlossen sind. Ein Board hinter einem USB-Bridge-Chip (CH340, FTDI, CP210x) kann sich nicht selbst ausweisen; sagen Sie dem Agenten, welches Board es ist. Der Upload läuft dann mit dem Hinweis, dass das Modell nicht geprüft wurde.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: einen Sketch untersuchen, Boards und Bibliotheksbeispiele auflisten, Board-, Core- und Bibliotheksabfragen, Kompilieren (das den Compiler und die Build-Hooks des Cores auf diesem Computer ausführt), Laufberichte und das Bereinigen von VERAs Build-Ordnern.
- Gerät lesen: Installieren von Cores, Bibliotheken und Indizes, das in VERAs Arduino-Umgebung herunterlädt, das Merken von Board und Port eines Sketches in dessen `sketch.yaml`, das Kopieren eines Bibliotheksbeispiels in die Workbench als neuen Sketch und das Entfernen alter Laufordner.
- Gerät schreiben: Hochladen, über USB oder über das Netzwerk, auch als Teil eines Kompiliervorgangs, das den Flash des Boards beschreibt und die neue Firmware sofort startet; außerdem jeder andere arduino-cli-Befehl, den der Agent mit `arduino-tool cli` weitergibt.
- Irreversibel: Hochladen mit `--programmer` oder das Brennen eines Bootloaders, das den Bootloader überschreibt. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.
- Gesperrt: jeder direkte `arduino-cli`-Befehl.

Im Modus Nachfragen fragt VERA vor jedem Befehl der Stufen Gerät lesen und Gerät schreiben nach; Auto-Edit führt Befehle der Stufe Gerät lesen ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64. Hochladen und das Lesen des seriellen Ports wurden noch nicht an einem echten Board ausgeführt.
- Auch das Hochladen über das Netzwerk (OTA) wurde noch nicht an einem echten Board ausgeführt.
- Befehle, die auf Eingaben warten, etwa der interaktive Monitor und Debugger von arduino-cli, und sein Daemon werden nicht ausgeführt.
- Die Profile einer `sketch.yaml` werden nicht verwendet; ihr Standard-Board und ihr Standard-Port schon.
