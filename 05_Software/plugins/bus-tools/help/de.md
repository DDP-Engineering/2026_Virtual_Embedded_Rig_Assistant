# Bus-Werkzeuge (I2C, SPI, UART)

Bus-Werkzeuge ermöglicht dem Agenten, begrenzte I2C-, SPI- und UART-Transaktionen auf Ihrer Schaltung über einen Bus Pirate 5 oder 6 im Binärmodus BPIO2 auszuführen. Es identifiziert den Adapter, konfiguriert einen Bus aus einem Profil, liest ein deklariertes Register, führt einen begrenzten Transfer aus oder zeichnet einen UART auf, stellt dann einen deklarierten Endzustand her und liest ihn zurück: standardmäßig HiZ mit abgeschalteten Pull-ups und abgeschalteter Versorgung. Passives Erfassen und Dekodieren bleibt beim Plugin sigrok. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **bus-tool**: ein Skript, das **Abhängigkeiten installieren** auf der Plugin-Seite installiert.
- Ein Bus Pirate 5 oder 6, einmalig mit seinem Terminalbefehl `binmode` auf BPIO2 umgestellt.
- `lab/resources.json` in der Workbench (Parameter `lab-resources`): ein Eintrag `bus-adapter` mit Alias, beiden seriellen Ports (Sie wählen, welcher der binäre ist), der USB-Identität und optionalen Leistungsgrenzen. Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob die Datei gültig ist.
- Ein Busprofil in der Workbench: Verdrahtung, Logikspannung, Versorgung, Buseinstellungen, Grenzwerte, Endzustand, Bausteine und Register. Beispiele werden mit dem Plugin geliefert (BME280, W25Q-Flash, UART-Konsole).

## Verwendung

- „Identifizieren Sie den Bus Pirate bp.“ (Skill `bus-transactions`)
- „Schreiben Sie ein Busprofil für den BME280 an Adresse 0x76, 3,3-V-Logik, externe Versorgung.“ (Skill `bus-profiles`)
- „Lesen Sie das Register chip_id des BME280 und prüfen Sie es gegen den erwarteten Wert.“
- „Lesen Sie 16 Bytes aus dem EEPROM ab 0x0010.“
- „Zeichnen Sie die UART-Konsole 10 Sekunden lang auf, nachdem Sie einen Wagenrücklauf gesendet haben.“

Nichts wird wiederholt: Ein NACK, eine fehlende Antwort oder ein unerwarteter Wert beendet den Lauf. Es gibt keinen Adressscan; Adressen stammen aus dem Datenblatt oder Schaltplan.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Auflisten serieller Ports, Beschreiben eines Profils und Laufberichte.
- Gerät lesen: Identifizieren des Adapters (eine Statusanfrage; Pins, Pull-ups und Versorgung werden nicht verändert).
- Gerät schreiben: Konfigurieren des Busses, Registerlesen (das zuerst die Registeradresse schreibt und Flags löschen kann), Transfers, UART-Aufzeichnung und Freigabe, weil jeder dieser Vorgänge die Pins des Adapters auf Ihre Schaltung treibt.
- Irreversibel: jeder Aufruf mit `--power`, der die Versorgung des Adapters einschaltet und die daran angeschlossene Schaltung mit Strom versorgt. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.

In den Modi Nachfragen und Auto-Edit fragt VERA vor jedem Befehl der Stufe Gerät schreiben nach.

## Grenzen

- Windows x64 und Linux x64. Nur gegen einen simulierten Adapter geprüft; noch keine echte Hardware.
- Kein Terminalzugriff und keine Änderung von Firmware oder Einstellungen am Adapter. Andere Adapter (Bus Pirate v3/v4, FT232H, CH341, Aardvark) werden nicht unterstützt.
- Nach einem unbestätigten Endzustand verweigert VERA Busoperationen, bis eine Freigabe ihn bestätigt.
- Referenz: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
