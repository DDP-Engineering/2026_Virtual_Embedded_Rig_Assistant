# ESP32 esptool

ESP32 esptool ermöglicht dem Agenten, Espressif-Chips über einen seriellen Port mit esptool v5 zu identifizieren, zu flashen, zu verifizieren, zu löschen und auszulesen. Es liest die Images und Offsets eines ESP-IDF-Builds, schreibt sie auf den Chip, prüft, dass jedes Image verifiziert wurde, und zeichnet das anschließende Boot-Log auf.

## Voraussetzungen

- **esptool** 5 von PyPI, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Das Plugin **serial-monitor**, das den Port des Boards findet und sein Boot-Log aufzeichnet. **Mit Abhängigkeiten installieren** fügt es hinzu.
- Ein Board der ESP32-Familie an einem seriellen Port. Unter Linux muss Ihr Benutzer in der Gruppe sein, der die seriellen Ports gehören: `dialout` (Debian, Ubuntu, Fedora) oder `uucp` (Arch).
- Keine Konfigurationsparameter.

## Verwendung

- „Welcher Chip hängt an COM5?“ (Skill `esp32-flash`)
- „Flashen Sie den ESP-IDF-Build in build/ auf den ESP32-S3 an COM5, verifizieren Sie ihn und zeigen Sie das Boot-Log.“
- „Prüfen Sie, ob das Board an COM5 noch diesen Build enthält.“
- „Sichern Sie den gesamten Flash des ESP32 an COM5 in backup.bin.“
- „Löschen Sie den Flash des Boards an COM5.“

Der Agent findet den Port mit dem Serial Monitor und rät ihn nie. Er bestätigt zuerst den Chiptyp und übergibt ihn dann an jeden Befehl, sodass ein falsches Board mit einem Fehler abbricht, statt beschrieben zu werden. Er verwendet die Offsets aus `build/flasher_args.json` exakt. Aktiviert der Build Secure Boot oder Flash-Verschlüsselung, hält er an und fragt Sie vor dem Flashen, weil ein solcher Bootloader beim ersten Start eFuses brennt. Vor dem Löschen weist er Sie darauf hin, dass auch NVS-Daten und WLAN-Zugangsdaten entfernt werden.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Befehle, die nur mit Dateien arbeiten (`merge-bin`, `image-info`, `elf2image`).
- Gerät lesen: Identifizieren des Chips, Lesen von MAC, Flash-ID und Sicherheitsstatus, Verifizieren und Auslesen des Flashs. Jeder Befehl, der eine Verbindung aufbaut, setzt den Chip in seinen Bootloader zurück und stoppt die laufende Firmware.
- Gerät schreiben: `write-flash`, `erase-flash`, `erase-region` und `load-ram`. Die Freigabekarte listet jedes Image mit seiner SHA-256 auf; wird ein Image nach Ihrer Freigabe neu gebaut, schlägt der Lauf fehl und wird erneut angefordert.
- Irreversibel: `write-mem`, `write-flash-status` und jeder Befehl mit `--force`, `--encrypt`, `--encrypt-files` oder `--ignore-flash-enc-efuse`. Diese können eFuse-Bits oder Flash-Sperrbits endgültig setzen oder einen gesicherten Chip unbootbar machen. Der Agent verwendet sie nur, wenn Sie genau diesen Befehl verlangen, und VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.

Im Modus Nachfragen fragt VERA vor jedem Befehl der Stufen Gerät lesen und Gerät schreiben nach; Auto-Edit führt Befehle der Stufe Gerät lesen ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64.
- Wenn der Chip nicht in seinen Bootloader wechselt, müssen Sie eventuell BOOT gedrückt halten, RESET drücken und BOOT loslassen.
- Referenz: https://docs.espressif.com/projects/esptool/en/latest/
