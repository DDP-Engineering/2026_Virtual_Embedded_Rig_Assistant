# GDB-Debugging

GDB-Debugging ermöglicht dem Agenten, Cortex-M-Firmware mit Symbolen zu debuggen, ohne Debugger-Konsole. Offline untersucht es ein Firmware-ELF. Über eine deklarierte Probe führt es pro Aufruf eine begrenzte, überwachte Sitzung aus: einen Snapshot von Registern, Backtrace, lokalen Variablen, RAM-Variablen und dekodiertem Fault-Zustand, einen Hardware-Breakpoint mit Zeitlimit oder begrenztes Schrittweise-Ausführen. Symbole werden nur angezeigt, wenn das ELF zum Flash des Targets passt. Die Ergebnisse landen in der Workbench unter `embedded-lab-results/<run-id>/`.

## Voraussetzungen

- **arm-none-eabi-gdb** 12 oder neuer und **OpenOCD** 0.12.0 oder neuer, die Sie selbst installieren (zum Beispiel die xPack-Builds oder `gdb-multiarch` und `openocd` unter Ubuntu); verwenden Sie dann **Abhängigkeiten prüfen** auf der Plugin-Seite. Probe-Treiber und USB-Berechtigungen richten Sie selbst ein.
- **gdb-elf** und **gdb-debug**: Skripte, die automatisch installiert werden.
- Für Live-Sitzungen eine Debug-Probe, die in `lab/resources.json` (Parameter `lab-resources`, optional) über USB-VID, PID und Seriennummer deklariert ist, mit einem Profil: `stm32f4-stlink` (Cortex-M4F) oder `stm32g0-stlink` (Cortex-M0+). Der Abschnitt **Konfiguration** der Plugin-Seite zeigt ihren Zustand.
- Das ELF genau des Images auf dem Board.

## Verwendung

- „Untersuchen Sie build/app.elf: Architektur, Symbole und Debug-Informationen.“ (Skill `debug-sessions`)
- „Das Board an stlink1 hängt. Erstellen Sie einen Snapshot mit build/app.elf, lassen Sie den Kern angehalten und dekodieren Sie den Fault.“
- „Lesen Sie die Variablen counter und state.mode im selben Snapshot.“
- „Lassen Sie die Firmware laufen, bis die Funktion sample erreicht ist, mit einem Zeitlimit von 30 Sekunden.“
- „Gehen Sie von hier aus drei Quellzeilen weiter.“

Der Agent fragt vor einer Live-Sitzung, was die Firmware ansteuert (Relais, Motoren, Heizungen), und lässt den Kern bei Firmware mit Aktorik beim Beenden nur mit Ihrem Einverständnis weiterlaufen. Wenn das ELF nicht zum Flash passt, meldet er die Symbole als unbekannt, statt zu raten.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: ELF-Untersuchung und Diagnose, Werkzeugversionen und das Aufräumen mit `release`.
- Gerät schreiben: `snapshot`, `break` und `step`. Jeder dieser Befehle hält den Kern über die Probe an, und `break` und `step` lassen Firmware laufen; die gewählte Beendigungsregel (angehalten oder fortsetzen) gilt am Ende. Nichts wird in Speicher oder Flash geschrieben. Die Modi Nachfragen und Auto-Edit fragen vor jedem dieser Befehle nach.
- Irreversibel: jede Sitzung mit `--firmware-effect actuates`, für Firmware, die Aktoren ansteuert: Das Anhalten kann einen Ausgang in seinem letzten Zustand lassen, und das Weiterlaufen lässt sie auf die Hardware einwirken. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.
- Gesperrt: der direkte Aufruf von GDB oder OpenOCD.

## Grenzen

- Windows x64 und Linux x64. Noch nicht mit echter Probe und echtem Board ausgeführt; beide Profile sind ungeprüft.
- Keine RTOS-Unterstützung, keine Peripherieregister, keine Speicherschreibvorgänge, kein Semihosting, kein SWO/ITM und kein eigenständiges Continue. Speicher wird nur als benannte Variablen, gestapelter Frame und Fault-Register gelesen.
- Referenzen: https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI.html und https://openocd.org/doc/html/GDB-and-OpenOCD.html
