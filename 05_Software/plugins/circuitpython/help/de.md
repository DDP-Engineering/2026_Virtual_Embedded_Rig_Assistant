# CircuitPython

CircuitPython bringt Code und kompatible Bibliotheken auf ein Board, auf dem bereits CircuitPython 9, 10 oder 11 läuft. Der Agent listet CIRCUITPY-Laufwerke und serielle Ports nach ihrer Identität auf, untersucht Firmware, Code und `/lib`, bereitet Bibliotheken aus einem festgelegten Tag des Adafruit-Bundles vor, überträgt freigegebene Dateien einzeln und geprüft und zeichnet die anschließende Konsolenausgabe auf. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **circuitpython-tool**: ein Skript, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Ein Board mit CircuitPython 9, 10 oder 11, per USB angeschlossen und mit eingehängtem CIRCUITPY-Laufwerk. Das Installieren der Firmware (UF2) ist Ihr Schritt; dieses Plugin tut das nie.
- Das festzulegende Tag des Adafruit-Bundles, ein Veröffentlichungsdatum des Adafruit CircuitPython Bundle (siehe https://circuitpython.org/libraries). Der Agent fragt Sie, wenn die Workbench noch keines verwendet.
- Keine benötigten Plugins und keine Konfigurationsparameter.

## Verwendung

- „Welche CircuitPython-Boards sind angeschlossen?“ (Skill `circuitpython-deploy`)
- „Identifizieren Sie das Board auf E: und zeigen Sie den Code und die Bibliotheken darauf.“
- „Prüfen Sie, ob die Bibliotheken in /lib zur Firmware des Boards passen.“ (Skill `circuitpython-libraries`)
- „Bereiten Sie adafruit_bme280 und neopixel für CircuitPython 9 aus dem Bundle 20261110 vor.“
- „Übertragen Sie app/code.py mit diesem Bibliothekssatz auf das Board auf E: und zeichnen Sie 10 Sekunden Konsolenausgabe von COM7 auf.“

Vor dem Schreiben kann der Agent das Laufwerk untersuchen, damit eine Übertragung Dateien verweigert, die Sie seitdem auf dem Board geändert haben. `settings.toml` und `secrets.py` werden aufgelistet, aber nie gelesen.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Auflisten von Laufwerken und Ports sowie Laufberichte.
- Gerät lesen: Identifizieren des Boards, Untersuchen seines Codes und seiner Bibliotheken sowie Lesen der Konsole, ohne etwas zu senden.
- Gerät schreiben: Vorbereiten von Bibliotheken (ein Download von github.com in VERAs Cache und die Workbench; kein Board wird berührt), Übertragen von Dateien auf das Laufwerk und eine Konsolenaufzeichnung mit `--reload`, die `code.py` stoppt und neu startet. Der neue Code läuft direkt nach einer Übertragung und kann alles ansteuern, was an die Pins des Boards angeschlossen ist; Stoppen hält ihn nicht an.
- Irreversibel: eine Übertragung mit `--boot`, die `boot.py` ersetzt. Sie kann diesem Computer das Laufwerk entziehen oder USB deaktivieren, bis das Board im abgesicherten Modus gestartet wird. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.

In den Modi Nachfragen und Auto-Edit fragt VERA vor jedem Befehl der Stufe Gerät schreiben nach.

## Grenzen

- Windows x64 und Linux x64.
- Kein REPL, kein als Argument übergebener Code, keine Firmware-Installation und keine Aktualisierung aller Bibliotheken.
- Ein USB-Laufwerk kennt keine dateiübergreifende Transaktion: Nach dem Abziehen oder Stoppen listet das Ergebnis auf, welche Dateien bestätigt sind.
- Referenz: https://docs.circuitpython.org/en/latest/docs/workflows.html
