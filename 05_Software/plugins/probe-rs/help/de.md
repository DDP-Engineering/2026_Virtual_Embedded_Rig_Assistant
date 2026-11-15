# probe-rs

Dieses Plugin ermöglicht dem Agenten, über probe-rs 0.32.0 mit einer an Ihren Computer angeschlossenen Debug-Probe zu arbeiten. Es identifiziert Probes und Targets, flasht und verifiziert genau das ELF des Builds, setzt das Target zurück, liest Speicher und Peripherieregister und streamt RTT-Logs im Hintergrund, auf ARM-, RISC-V- und unterstützten Xtensa-Targets (zum Beispiel `esp32`, `esp32s3`, `esp32c3`).

## Voraussetzungen

- **probe-rs 0.32.0.** VERA sucht zuerst im PATH und in `~/.cargo/bin`; findet es nichts, lädt **Abhängigkeiten installieren** das festgelegte portable Release in den Programmordner von VERA herunter. Eine gefundene Installation einer anderen Version wird als nicht verfügbar gemeldet: Korrigieren Sie zuerst den PATH oder diese Installation.
- **Eine Debug-Probe und ein Zielboard**, mit Treibern und Gerätezugriff, die Sie selbst einrichten. Unter Linux sind das die udev-Regel von probe-rs und die Mitgliedschaft in `plugdev`. Unter Windows verwendet ST-Link den ST-Treiber STSW-LINK009, J-Link und FTDI brauchen WinUSB, und CMSIS-DAP braucht normalerweise nichts weiter. VERA installiert nie Treiber oder Regeln. Einrichtungsanleitung: https://probe.rs/docs/getting-started/probe-setup/
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt` und `probe-rs-inspect`. Er nennt immer die Probe und den Chip, die er beobachtet hat, und leitet sie nie aus einem Beispiel ab.

- „Listen Sie die angeschlossenen Debug-Probes auf und identifizieren Sie das Target am ST-Link.“
- „Flashen Sie build/app.elf auf den STM32, verifizieren Sie es und setzen Sie das Target zurück.“
- „Verbinden Sie sich mit dem Target und verfolgen Sie das RTT-Log, bis es 'ready' ausgibt, und stoppen Sie dann.“
- „Lesen Sie das Register RCC_CR des STM32F4 und dekodieren Sie seine Felder.“
- „Die Firmware ist in einen HardFault gelaufen: Ordnen Sie den gestapelten PC und LR Quellzeilen zu.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Hilfe, Version, die Target-Liste und das Auflisten von Probes; diese bauen keine Verbindung zu einem Target auf.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): info, read, verify, attach, profile und trace können das Target kurz anhalten; reset startet es neu, ohne die Firmware zu ändern.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): download, run, erase und benchmark überschreiben Flash oder RAM; itm konfiguriert die Trace-Hardware. Die Freigabe ist an den Hash des ELF gebunden.
- **Irreversibel** (fragt nach, und Sie geben das Bestätigungswort `write` ein): Schreiben beliebigen Speichers, weil ein Schreibvorgang in einen Flash-Controller oder ein Option-Register dauerhaften Leseschutz aktivieren kann und ein Schreibvorgang in ein GPIO-Register Pins ansteuert. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.
- **Gesperrt**: interaktives Debugging, GDB- und DAP-Server, Shell-Vervollständigung und Remote-Probes (`--host`).

## Grenzen

- Windows x64, Linux x64 und Linux ARM64.
- RTT-Eingabe wird nicht unterstützt; Firmware mit RTT-Down-Kanälen ist noch nicht im Labor geprüft.
- Das Plugin wurde noch nicht mit einer echten Probe und einem echten Board geprüft.
