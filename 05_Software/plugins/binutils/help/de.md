# GNU binutils (ARM, RISC-V)

GNU binutils ermöglicht dem Agenten, lokale ARM- und RISC-V-Firmware-ELF-Dateien mit `size`, `nm`, `readelf`, `objdump` und `addr2line` aus den Toolchains `arm-none-eabi-` und `riscv-none-elf-` zu untersuchen. Es vergleicht Sektions- und Symbolgrößen zwischen zwei Builds, erklärt das Speicherlayout, disassembliert eine Funktion oder einen kleinen Adressbereich und löst Absturzadressen in Funktionen und Quellzeilen auf. Es liest nur Dateien auf diesem Computer und greift nie auf ein Board zu.

## Voraussetzungen

- Die zehn binutils-Programme (fünf pro Architektur). VERA sucht zuerst nach einer bereits vorhandenen Toolchain: PATH, STM32CubeCLT und STM32CubeIDE (ARM), PlatformIO, Arduino, das Zephyr SDK und xPack-Ordner. Eine Toolchain an einem anderen Ort kann in den PATH aufgenommen werden.
- Wird keine gefunden, lädt **Abhängigkeiten installieren** auf der Plugin-Seite die festgelegte xPack-Toolchain (ARM 15.2.1-1.1, RISC-V 15.2.0-1) in den Programmordner von VERA herunter und prüft ihre SHA-256. Nichts wird global installiert.
- Die ELF-Datei genau des Builds, den Sie untersuchen. Ein späterer Neu-Build kann plausible, aber falsche Quellzeilen liefern.
- Keine benötigten Plugins, keine Hardware und keine Konfiguration. Espressif-ELF-Dateien und -Toolchains gehören zum Plugin esp32-idf.

## Verwendung

- „Vergleichen Sie build/v1.2/app.elf mit build/v1.3/app.elf und sagen Sie mir, welche Symbole am stärksten gewachsen sind.“ (Skill `firmware-size`)
- „Woher kommen die 2 KB zusätzlicher RAM im neuen Build?“
- „Dekodieren Sie diesen HardFault: PC 0x08001a3c, LR 0x08001a11, mit build/app.elf.“ (Skill `crash-decode`)
- „Zeigen Sie die Sektionen und Ladesegmente von firmware.elf und prüfen Sie sie gegen das Linker-Skript.“ (Skill `elf-inspect`)
- „Disassemblieren Sie die Funktion `uart_rx_handler` mit ihrem Quellcode.“

Der Agent disassembliert nur die untersuchte Funktion oder den untersuchten Adressbereich, nie das ganze Image. Er meldet `??` oder `:0` als nicht aufgelöst, statt eine Zeile zu raten.

## Risiko und Freigaben

Jeder Befehl dieses Plugins ist als sicher eingestuft: Die Programme analysieren Dateien auf dem Host und greifen nie auf Hardware zu, daher laufen sie in jedem Berechtigungsmodus ohne Rückfrage, auch in Nur lesen. Es gibt keine Befehle der Stufen Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64, Linux x64 und Linux arm64. Die Linux-arm64-Archive sind geprüft, ihre Ausführung auf einem arm64-Host ist aber noch nicht nachgewiesen.
- Ein vorhandenes Programm, dessen Version sich nicht lesen lässt, bleibt nicht verfügbar; VERA lädt nicht stillschweigend ein anderes herunter.
- Die an den Agenten zurückgegebene Befehlsausgabe ist auf die letzten 12.000 Zeichen begrenzt; die vollständige Ausgabe bleibt im Laufprotokoll.
- Referenz: https://sourceware.org/binutils/docs/binutils/
