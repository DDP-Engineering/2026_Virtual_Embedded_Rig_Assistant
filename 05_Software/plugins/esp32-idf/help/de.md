# ESP32 ESP-IDF

ESP32 ESP-IDF ermöglicht dem Agenten, ESP-IDF-Projekte zu bauen und zu reparieren, Firmware-Größen zu melden, das Ergebnis auf ein Board zu flashen und ESP32-Panics zu analysieren: Er löst Guru-Meditation-Backtraces mit dem passenden ELF in Quellzeilen auf und liest Core Dumps vom Chip. Es verwendet das ESP-IDF, das Sie selbst installiert und ausgewählt haben.

## Voraussetzungen

- **ESP-IDF 5.4 oder neuer (unter 7)**, installiert mit dem ESP-IDF Installation Manager (EIM). VERA findet `idf.py` über EIM, installiert es aber nie. Installieren Sie ESP-IDF mit EIM, wählen Sie die Version mit `eim select`, nehmen Sie `eim` in den PATH auf, starten Sie VERA und verwenden Sie dann **Abhängigkeiten prüfen** auf der Plugin-Seite. Anleitung: https://docs.espressif.com/projects/idf-im-ui/en/latest/
- Die Xtensa- und RISC-V-Decoder `addr2line` aus den ESP-IDF-Toolchains, ebenfalls mit EIM installiert. Für ein eigenes Tools-Stammverzeichnis starten Sie VERA mit `IDF_TOOLS_PATH`, das auf dieses Verzeichnis gesetzt ist.
- USB-Treiber für Ihr Board, von Ihnen installiert.
- Das Plugin **serial-monitor**, das den Port des Boards findet und die Konsole aufzeichnet. **Mit Abhängigkeiten installieren** fügt es hinzu.
- Keine Konfigurationsparameter.

## Verwendung

- „Bauen Sie das Projekt in firmware/ und beheben Sie den ersten Kompilierfehler.“ (Skill `esp32-build-fix`)
- „Aktivieren Sie in sdkconfig.defaults den Core Dump in den Flash, konfigurieren Sie neu und bauen Sie neu.“
- „Welche Komponenten belegen den meisten Flash?“
- „Flashen Sie den Build auf das Board an COM5.“
- „Das Board ist mit einer Guru Meditation abgestürzt. Zeichnen Sie sie an COM5 auf und dekodieren Sie den Backtrace mit dem geflashten ELF.“ (Skill `esp32-panic`)
- „Lesen Sie den Core Dump vom Board an COM5.“

Der Agent bearbeitet nie die generierte `sdkconfig`; er ändert `sdkconfig.defaults`, konfiguriert neu und prüft die wirksame Konfiguration. Er dekodiert einen Backtrace nur mit dem ELF genau des geflashten Builds und sagt es, wenn die Übereinstimmung unbekannt ist.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Build, Größenberichte, `set-target`, `fullclean`, `reconfigure` und die addr2line-Decoder. `set-target` und `fullclean` entfernen generierte Build-Ausgaben.
- Gerät lesen: `coredump-info`, das die Core-Dump-Partition liest und das Board zurücksetzen kann.
- Gerät schreiben: `flash`, `app-flash`, `erase-flash` und `erase-otadata`, die Firmware oder Daten auf dem Chip überschreiben; das Löschen der OTA-Daten ändert die ausgewählte App.
- Irreversibel: `efuse-*`- und `secure-*`-Befehle, die den Chip dauerhaft verändern können. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass. Eine Build-Reparatur braucht sie nie.
- Gesperrt: `monitor`, `menuconfig`, `gdb` und `gdbtui`, die interaktiv sind, einschließlich `flash monitor`. Verwenden Sie den Serial Monitor zum Aufzeichnen der Konsole.

Im Modus Nachfragen fragt VERA vor jedem Befehl der Stufen Gerät lesen und Gerät schreiben nach; Auto-Edit führt Befehle der Stufe Gerät lesen ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64.
- Der EIM-Befehlstransport ist mit EIM 0.20.1 geprüft. Ein echter ESP-IDF-Build, ein Flashvorgang und eine Panic-Dekodierung auf Hardware sind noch nicht nachgewiesen.
- Referenzen: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-py.html und https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html
