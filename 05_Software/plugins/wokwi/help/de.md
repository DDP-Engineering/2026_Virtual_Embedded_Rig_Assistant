# Wokwi-Cloud-Simulation

Dieses Plugin ermöglicht dem Agenten, Firmware-Simulationen und begrenzte Testszenarien in der Cloud von Wokwi mit dem festgelegten wokwi-cli 0.29.1 auszuführen. Der Agent untersucht ein Projekt, validiert sein Diagramm offline, bereitet einen Job aus exakten Kopien mit Sendeliste, Konto, Grenzwerten und Zeitbudget vor, führt ihn nach Ihrer Freigabe einmal in der Cloud aus und holt dann das Ergebnis mit serieller Ausgabe, VCD und Screenshots ab. Die Ergebnisse landen unter `arduino-iot-results/`. Eine Cloud-Simulation ist kein elektrischer Test und kein Test auf dem echten Board.

## Voraussetzungen

- **wokwi-cli 0.29.1**, das **Abhängigkeiten installieren** aus seinem GitHub-Release (https://github.com/wokwi/wokwi-cli/releases/tag/v0.29.1) herunterlädt und per SHA-256 prüft, und **wokwi-tool**, ein Python-Skript im Plugin, das VERA selbst installiert.
- **Ein Wokwi-CI-Token** (`wokwi-token`) aus Ihrem Wokwi-Dashboard, gespeichert unter einer Referenz wie `ci`. Legen Sie es im Abschnitt **Konfiguration** der Plugin-Seite fest. Das Token bleibt im Zugangsdatenspeicher von VERA und erreicht nur einen freigegebenen Lauf dieses Plugins; der Agent sieht es nie.
- Ein Wokwi-Projekt mit einer gebauten Firmware (`.hex`, `.bin`, `.uf2`, `.elf` oder ESP-IDF-`flasher_args.json`) und einem Diagramm mit genau einem Board. Das Plugin baut nie.
- Es werden keine Hardware und keine anderen Plugins benötigt.

## Verwendung

Der Agent verwendet die Skills `wokwi-simulation` und `wokwi-scenarios`. Vor dem Cloud-Lauf zeigt er Ihnen die zu sendenden Dateien, das Konto, das Board und die Zeitgrenzen und wartet auf Sie.

- „Untersuchen Sie das Wokwi-Projekt in sim/blink und validieren Sie sein Diagramm.“
- „Schreiben Sie ein Szenario, das btn1 drückt und erwartet, dass led1 leuchtet.“
- „Bereiten Sie einen Job für sim/blink mit dem Konto ci und einem virtuellen Zeitlimit von 5 Sekunden vor, führen Sie ihn aus und schreiben Sie dann einen Bericht.“
- „Simulieren Sie die Firmware, bis sie ready ausgibt; brechen Sie mit Fehler ab, wenn sie panic ausgibt.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Untersuchen des Projekts, Validieren des Diagramms, Vorbereiten eines Jobs, Abholen von Ergebnissen und Berichte. Diese laufen offline; nichts wird gesendet, und das Projekt wird nie geändert.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Ausführen eines Jobs, weil er Diagramm, Firmware und ELF an die Server von Wokwi sendet, was sich nicht zurückholen lässt, und der Lauf auf Ihren Wokwi-Tarif angerechnet wird. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.
- **Gesperrt**: das direkte Ausführen von wokwi-cli, weil es alles hochladen würde, was sein Projektordner enthält, und einen MCP-Server anbietet.

## Grenzen

- Windows x64 und Linux x64.
- Custom Chips, SD-Karten, GDB- und RFC-2217-Server werden abgelehnt.
- VERA kann Ihr Wokwi-Kontingent nicht lesen. Nach Stoppen ist das Ende des Jobs auf Wokwi-Seite nicht bestätigt.
- Mit diesem Plugin wurde noch kein echter Cloud-Lauf durchgeführt.
