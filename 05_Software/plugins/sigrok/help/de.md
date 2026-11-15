# sigrok (DDP-Fork)

Dieses Plugin ermöglicht dem Agenten, digitale und analoge Signale aufzuzeichnen und zu dekodieren sowie Labormessgeräte über sigrok-cli auszulesen oder zu konfigurieren. Aufzeichnungen sind begrenzt und werden als srzip-Dateien in der Workbench gespeichert; gespeicherte Aufzeichnungen lassen sich offline mit UART, I2C, SPI, CAN, 1-Wire und, im DDP-Fork, einem Ethernet-Decoder-Stack dekodieren. Der DDP-Fork von sigrok ergänzt Treiber für den Logikanalysator ATK-DL16 und das Mixed-Signal-Oszilloskop Hantek DSO-3062L.

## Voraussetzungen

- **sigrok-cli.** **Abhängigkeiten installieren** bietet ein per SHA-256 festgelegtes Paket des DDP-Forks für die aktuelle Plattform an; es hat Vorrang vor einer lokalen Installation. Bis es installiert ist, verwendet VERA ein sigrok-cli im PATH (unter Linux auch `/usr/bin/sigrok-cli`). Ein Upstream-sigrok-cli kann Protokolle dekodieren und die Geräte verwenden, die es auflistet, hat aber nicht die Treiber des Forks.
- **Ein unterstütztes Messgerät** und USB-Zugriff, die Sie selbst einrichten. Unter Linux installieren Sie die udev-Regeln des Forks und von libsigrok, treten der Gruppe `plugdev` bei und melden sich erneut an. Unter Windows binden Sie bei Bedarf WinUSB mit Zadig an das Gerät von Hantek, ATK-DL16 oder der fx2lafw-Klasse.
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `sigrok-capture`, `sigrok-decode`, `sigrok-instruments`, `atk-dl16` und `hantek-dso3062l`. Er prüft, welche Treiber das installierte sigrok-cli hat, und rät nie eine Verbindung.

- „Zeichnen Sie 100 000 Abtastwerte von D0 bis D2 am ATK-DL16 mit 10 MHz in captures/logic.sr auf.“
- „Triggern Sie auf eine steigende Flanke von D8 und zeichnen Sie einen Puffer auf.“
- „Nehmen Sie einen einzelnen Frame vom Hantek DSO-3062L auf.“
- „Dekodieren Sie den UART auf D0 mit 115200 Baud in captures/logic.sr.“
- „Lesen Sie die Spannung des Korad-Netzgeräts an COM3.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Hilfe, Version, die Listen der unterstützten Elemente und das Dekodieren einer gespeicherten Aufzeichnung.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Scannen, Auflisten serieller Ports, Anzeigen eines Treibers, Lesen von Werten und begrenzte Aufzeichnungen mit explizitem Treiber.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Ändern von Geräteeinstellungen, einschließlich eines Lesevorgangs, der zuerst Einstellungen anwendet.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Ändern von Einstellungen an Netzgeräten, elektronischen Lasten, Signalgeneratoren, Relais und ähnlichen Geräten mit Ausgängen, jede Einstellung ohne expliziten Treiber und der PWM-Generatorausgang des ATK-DL16. In **Bypass — voller Zugriff** laufen diese ohne Rückfrage.

## Grenzen

- Windows x64, Linux x64 und Linux ARM64.
- Die festgelegten Pakete verweisen auf ein privates Release, das noch nicht veröffentlicht ist; bis dahin verwenden Sie ein sigrok-cli im PATH.
- Eine lokale Versionsangabe belegt nicht, dass die Treiber des Forks vorhanden sind; der Agent prüft selbst auf `atk-dl16` und `hantek-dso3062l`.
- Ein Trigger, der nie auslöst, kann null Abtastwerte und keine Datei ergeben.
