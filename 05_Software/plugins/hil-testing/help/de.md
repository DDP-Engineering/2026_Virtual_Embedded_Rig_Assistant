# HIL-Tests

HIL-Tests führt begrenzte Hardware-in-the-Loop-Testpläne auf einem echten Board aus. Ein Plan ist eine JSON-Datei, nie ein Skript: Aufbau, Firmware und ihre SHA-256, Verdrahtung, die Wirkung der Firmware auf die Außenwelt, Schritte, ein Zeitbudget und das Aufräumen. VERA übersetzt jeden Schritt in eine Operation eines anderen aktivierten Plugins, fragt eine einzige Freigabe für den ganzen Plan an, reserviert Probe, serielle Ports und Messgeräte und führt die Schritte aus. Das Aufräumen läuft immer, auch nach Stoppen oder einer Zeitüberschreitung. Ergebnisse und Berichte (JSON, JUnit, HTML, Markdown) landen in der Workbench unter `embedded-lab-results/<run-id>/`.

## Voraussetzungen

- **hil**: ein Skript im Plugin, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Die Plugins, deren Operationen der Plan verwendet, aktiviert in der Workbench: probe-rs, esp32-esptool, serial-monitor, scpi-instruments und lab-validation.
- Das Board mit seiner Probe oder seinem seriellen Port sowie Messgeräte, die in `lab/resources.json` deklariert sind, wenn der Plan sie über einen Alias nennt.
- Die zu testende Firmware-Datei; der Plan hält ihre SHA-256 fest.

## Verwendung

- „Schreiben Sie einen HIL-Smoke-Test für den Blinky-Build auf dem NUCLEO-F401RE: flashen, zurücksetzen, auf READY warten, ping senden und die Blinkfrequenz der LED mit dem Oszilloskop prüfen.“ (Skill `hil-planning`)
- „Prüfen Sie den Plan hil/blinky.json und zeigen Sie mir jede Operation und ihr Risiko.“
- „Führen Sie hil/blinky.json im Hintergrund aus.“
- „Warum ist der Plan fehlgeschlagen? Zeigen Sie den fehlgeschlagenen Schritt und sein Log.“

Bevor der Agent einen Plan schreibt, fragt er Sie, was die Firmware ansteuert (Relais, Motoren, Heizungen, Ausgänge), und wählt im Zweifel nie eine geringere Wirkung. `hil check` berührt keine Hardware und zeigt die vollständige Erweiterung zu Ihrer Prüfung.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: `hil check` und `hil report`.
- `hil run`: eine einzige Freigabe für den ganzen Plan, auf der höchsten Risikostufe seiner Operationen, wie die anderen Plugins sie einstufen, und der deklarierten Wirkung der Firmware, wenn der Plan flasht oder zurücksetzt; nie niedriger als Gerät lesen. Bei einem irreversiblen Plan geben Sie die Plan-ID ein. Ein Plan, eine Firmware oder ein Laborregister, die nach der Freigabe geändert wurden, werden abgelehnt.
- Schritte zum Flashen, Zurücksetzen, Ausgeben und Konfigurieren laufen einmal; sie können nicht wiederholt werden.

Endet ein Lauf mit dem physischen Zustand `unknown`, ist nicht bekannt, ob der Laboraufbau sicher ist; der Agent sagt es Ihnen zuerst.

## Grenzen

- Windows x64 und Linux x64. Unter Windows nur mit Platzhaltern getestet; natives Ubuntu und ein echtes Board sind noch nicht ausgeführt.
- Schritte laufen einzeln nacheinander, außer UART-Aufzeichnungen im Hintergrund und gehaltener Versorgung. Starten Sie eine Boot-Log-Aufzeichnung vor dem Zurücksetzen im Hintergrund, sonst geht das Log verloren.
- VERA kann Programme außerhalb von VERA nicht aussperren.
- Schritte für GDB, Zephyr, PlatformIO und Twister sind nicht verfügbar.
