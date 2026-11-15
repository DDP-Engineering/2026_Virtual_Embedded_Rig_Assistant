# STM32CubeProgrammer

Dieses Plugin ermöglicht dem Agenten, STM32-Bausteine mit Ihrem eigenen STM32CubeProgrammer (STM32_Programmer_CLI) zu programmieren. Es verbindet sich über einen ST-LINK oder einen UART-, USB-DFU-, SPI-, I2C- oder CAN-Bootloader, liest Speicher, flasht und verifiziert Images, löscht, setzt zurück und liest oder ändert Option Bytes. Verwenden Sie es, um ein STM32-Board zu programmieren oder seinen Schutzstatus zu prüfen.

## Voraussetzungen

- **STM32CubeProgrammer**, das Sie selbst von https://www.st.com/en/development-tools/stm32cubeprog.html installieren (ein ST-Konto ist erforderlich), oder STM32CubeIDE, das es mitliefert. VERA lädt es nie herunter; es sucht in den Standardinstallationsordnern und im PATH.
- Unter Linux braucht eine Installation an einem eigenen Ort einen kleingeschriebenen Link `stm32_programmer_cli` im PATH.
- Eine ST-LINK-Probe oder eine Bootloader-Verbindung und das Zielboard. Der Installer fügt unter Windows die ST-LINK-Treiber hinzu; unter Linux installieren Sie die udev-Regeln von ST selbst.
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `stm32-flash` und `stm32-option-bytes`. Er stimmt Probe und Schnittstelle mit Ihnen ab, bevor er sich verbindet.

- „Listen Sie die angeschlossenen ST-LINK-Probes auf.“
- „Verbinden Sie sich über SWD und nennen Sie mir Device-ID und Flash-Größe.“
- „Flashen Sie build/app.elf über SWD, verifizieren Sie es und setzen Sie das Board zurück.“
- „Lesen Sie 4 KB Flash ab 0x08000000 in captures/flash.bin.“
- „Zeigen Sie die Option Bytes und erklären Sie jedes Feld.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Hilfe, Version, Ausgabeeinstellungen, Werkzeuge für Host-Dateien und Auflisten von Probes ohne Verbindungsaufbau.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Verbinden, Lesen, Verifizieren, Resets, Halt/Run/Step und Anzeigen von Option Bytes, OTP oder Product State. Resets beeinflussen das laufende Programm.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Schreiben, Löschen oder Füllen von Flash oder RAM, Ausführen von Code, Schreiben von Core-Registern und Änderungen am Wireless-Stack; außerdem unbekannte Befehle. Ein Hex-, SREC- oder ELF-Image kann Option-Byte- oder OTP-Segmente enthalten, die ein Schreibvorgang ebenfalls programmiert.
- **Irreversibel** (fragt nach, und Sie geben den Befehl ein, zum Beispiel `-ob`): Schreiben von Option Bytes, Rücknahme von Leseschutz und TrustZone (Mass Erase), Sperren und Entsperren von RDP, OTP, Schlüssel, Secure Firmware, Product State, Debug-Authentifizierung, HSM-Lizenzen und das Schalten der Target-Versorgung. RDP-Level 1 lässt sich nur durch einen Mass Erase aufheben; RDP-Level 2 ist dauerhaft und sperrt den Debug-Zugriff für immer. In **Bypass — voller Zugriff** laufen diese ohne Rückfrage.
- **Gesperrt**: Skriptdateien, weil VERA die darin enthaltenen Befehle nicht einstufen kann.

## Grenzen

- Windows x64 und Linux x64. Die Regeln wurden an STM32CubeProgrammer 2.23.0 ermittelt; Befehle späterer Versionen gelten als unbekannt, bis die Regeln sie aufführen.
- Dateien, die die CLI auf Ihrem Computer schreibt (Speicherauszüge, Logs, Register-Dumps), brauchen keine separate Freigabe.
- Das Plugin hat sich noch nicht mit einem echten Board verbunden und noch keine Option Bytes geändert.
