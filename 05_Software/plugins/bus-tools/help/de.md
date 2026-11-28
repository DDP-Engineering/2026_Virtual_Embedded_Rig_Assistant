# Bus-Werkzeuge (I2C, SPI, UART)

Bus-Werkzeuge ermöglicht dem Agenten, über einen Bus Pirate 5 oder 6 im Binärmodus BPIO2 per I2C, SPI und UART mit Ihrer Schaltung zu sprechen. Es identifiziert den Adapter, liest die Spannung an seinen Pins, scannt einen I2C-Bus nach antwortenden Adressen, liest und schreibt Register, führt Transfers und Abfolgen von Schritten mit Pausen aus und zeichnet einen UART als Text auf. Nach jedem Aufruf kehrt der Adapter zu HiZ mit abgeschalteten Pull-ups und abgeschalteter Versorgung zurück, sofern Sie den Bus nicht erhalten lassen. Passives Erfassen und Dekodieren bleibt beim Plugin sigrok. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **bus-tool**: ein Skript, das **Abhängigkeiten installieren** auf der Plugin-Seite installiert.
- Ein Bus Pirate 5 oder 6, einmalig mit seinem Terminalbefehl `binmode` auf BPIO2 umgestellt.
- `lab/resources.json` in der Workbench (Parameter `lab-resources`): ein Eintrag `bus-adapter` mit Alias, beiden seriellen Ports (Sie wählen, welcher der binäre ist) und der USB-Identität; Leistungsgrenzen sind optional. Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob die Datei gültig ist.
- Für einen ersten Kontakt nichts weiter: Der Agent scannt und spricht mit einem Baustein mit den üblichen Einstellungen. Ein Busprofil in der Workbench ist optional; es gibt Bausteinen und Registern Namen und bewahrt die Einstellungen. Beispiele werden mit dem Plugin geliefert (BME280, W25Q-Flash, UART-Konsole).

## Verwendung

- „Identifizieren Sie den Bus Pirate bp.“ (Skill `bus-transactions`)
- „Scannen Sie den I2C-Bus und sagen Sie mir, welche Bausteine antworten.“
- „Nichts antwortet: Prüfen Sie die Spannungen an den Pins des Adapters.“
- „Lesen Sie Register 0xD0 des Bausteins an Adresse 0x76.“
- „Schreiben Sie ein Busprofil für den BME280 an Adresse 0x76.“ (Skill `bus-profiles`)
- „Starten Sie eine erzwungene Messung am BME280, warten Sie 10 ms und lesen Sie das Ergebnis.“
- „Zeichnen Sie die UART-Konsole 10 Sekunden lang auf, nachdem Sie einen Wagenrücklauf gesendet haben.“

Jeder Schritt wird einmal gesendet: Ein Baustein, der nicht bestätigt, eine fehlende Antwort oder ein unerwarteter Wert beendet den Lauf, und das Ergebnis nennt die Busleitungen, die auf Low liegen.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Auflisten serieller Ports, Beschreiben eines Profils und Laufberichte.
- Gerät lesen: Identifizieren des Adapters und Lesen seiner Pinspannungen (eine Statusanfrage; Pins, Pull-ups und Versorgung werden nicht verändert).
- Gerät schreiben: der Scan, Konfigurieren des Busses, Registerlesen (das zuerst die Registeradresse schreibt und Flags löschen kann), Registerschreiben, Transfers, Abfolgen, UART-Aufzeichnung und Freigabe, weil jeder dieser Vorgänge die Pins des Adapters auf Ihre Schaltung treibt. Ein solcher Aufruf schaltet auch die Versorgung des Adapters ein, um die Schaltung zu speisen, wenn Sie oder das Profil es verlangen.

In den Modi Nachfragen und Auto-Edit fragt VERA vor jedem Befehl der Stufe Gerät schreiben nach.

## Grenzen

- Windows x64 und Linux x64. Nur gegen einen simulierten Adapter geprüft; noch keine echte Hardware.
- Kein Terminalzugriff und keine Änderung von Firmware oder Einstellungen am Adapter. Andere Adapter (Bus Pirate v3/v4, FT232H, CH341, Aardvark) werden nicht unterstützt.
- Eine Transaktion überträgt höchstens 512 Bytes je Richtung; eine UART-Aufzeichnung läuft höchstens 300 s und behält 1 MiB.
- Referenz: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
