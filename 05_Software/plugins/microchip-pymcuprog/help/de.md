# Microchip pymcuprog (AVR, PIC)

Dieses Plugin ermöglicht dem Agenten, Microchip-AVR- (UPDI) und PIC-Bausteine mit pymcuprog zu identifizieren, zu programmieren, zu verifizieren und zu löschen, ihre Speicher zurückzulesen sowie Fuses und Konfigurationswörter zu lesen oder zu ändern. Es arbeitet über ein Curiosity-Nano- oder Xplained-Kit mit nEDBG, ein PICkit 4 oder MPLAB Snap im AVR-Modus, einen Atmel-ICE oder einen SerialUPDI-Adapter.

## Voraussetzungen

- **pymcuprog 3.19** (unter 4), ein Python-Paket, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- Ein unterstützter Programmer oder ein unterstütztes Kit und das Zielboard. Ein SerialUPDI-Adapter ist ein beliebiger USB-Seriell-Adapter mit einem Widerstand zwischen RX, TX und UPDI.
- Unter Windows brauchen die USB-Werkzeuge keinen zusätzlichen Treiber. Unter Linux benötigen Sie für den Zugriff auf nEDBG, PICkit und Atmel-ICE eventuell die udev-Regeln aus der README von pymcuprog (https://github.com/microchip-pic-avr-tools/pymcuprog).
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `microchip-flash` und `microchip-fuses`. Sagen Sie ihm, welches Werkzeug und welchen Baustein Sie verwenden; er rät sie nicht.

- „Pingen Sie den ATtiny416 am SerialUPDI-Adapter an COM5.“
- „Schreiben Sie build/app.hex auf den ATtiny416, löschen Sie vorher und verifizieren Sie.“
- „Lesen Sie die ersten 64 Bytes des Flashs und speichern Sie das EEPROM in captures/eeprom.hex.“
- „Lesen Sie die Fuses des ATtiny416, speichern Sie sie als Datensatz und erklären Sie jedes Byte.“
- „Setzen Sie Fuse 2 (OSCCFG) auf 0x01, lesen Sie die Fuses dann erneut und vergleichen Sie.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Hilfe, Versions- und Release-Informationen sowie das Konvertieren einer Hex-Datei nach UF2.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Ping, Lesen, Verifizieren, Zurücksetzen und Spannungsmessungen.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Schreiben von Flash, EEPROM oder User Row, Chip Erase, Neustart des Debuggers sowie Löschen oder Schreiben eines gesperrten UPDI-Bausteins. Ein Argument, das pymcuprog ablehnen würde, wird ebenfalls als Gerät schreiben behandelt.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort `write` oder `erase` ein): jedes Schreiben einer Hex-Datei, weil eine Intel-Hex-Datei Fuse-, Konfigurationswort- und Lock-Bit-Daten enthalten kann; jedes Schreiben oder Löschen von Fuses, Konfigurationswörtern oder Lock-Bits; das Ändern der Versorgungsspannung des Kits; jeder Befehl mit UPDI-Hochspannung (12 V, `-H`). Eine falsche Fuse kann UPDI oder Reset deaktivieren, und Lock-Bits aktivieren den Codeschutz. In **Bypass — voller Zugriff** laufen diese ohne Rückfrage.

## Grenzen

- Windows x64 und Linux x64.
- pymcuprog 3.19 steuert kein PICkit 5 an.
- Die Dateien, die ein Lesen in eine Datei oder eine UF2-Konvertierung auf Ihrem Computer schreibt, werden nicht separat freigegeben.
- Das Plugin wurde noch nicht mit einem echten Werkzeug oder Board getestet.
