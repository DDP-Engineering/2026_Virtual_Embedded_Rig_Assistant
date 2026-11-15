# Virtuelle Boards mit Renode

Dieses Plugin ermöglicht dem Agenten, ein Firmware-ELF mit dem festgelegten Renode 1.17.0 auf einem unterstützten virtuellen Board auszuführen, vor oder ganz ohne Hardware. Der Agent listet die unterstützten Board-Profile auf, prüft eine Firmware vor jedem Lauf gegen Architektur, Speicherabbild und Boot-Adresse eines Profils, startet sie ohne Oberfläche, zeichnet ihren UART auf und führt freigegebene Testsätze aus (UART-Zeilen, Timer-Ticks, Taster- und UART-Stimuli, die modellierte LED), mit getrennten Budgets für virtuelle und reale Zeit. Die Ergebnisse landen unter `embedded-lab-results/` und gelten immer als virtueller Beleg, nicht als Hardwaretest.

## Voraussetzungen

- **Renode 1.17.0.** **Abhängigkeiten installieren** lädt das festgelegte portable Paket in den Programmordner von VERA herunter und prüft seine SHA-256; ein Renode 1.17.0 im PATH funktioniert ebenfalls. Eine andere Version des Simulators blockiert einen Lauf.
- **renode-sim**, ein Python-Skript im Plugin, das VERA selbst installiert. Der Agent arbeitet immer darüber.
- Ein Firmware-ELF, das für ein unterstütztes Board gebaut ist. Das erste Profil ist `stm32f4-discovery` (STM32F407, Cortex-M4F) mit dem freigegebenen Testsatz `board-basics`.
- Keine Hardware, keine anderen Plugins und keine Konfiguration. Sie können eigene Profile in `renode/profiles/<id>/` und Testsätze in `renode/tests/<id>/` der Workbench hinzufügen; sie werden wie die des Plugins geprüft.

## Verwendung

Der Agent verwendet den Skill `virtual-boards`. Er nennt Architektur und Boot-Adresse explizit und wechselt nie zu einem anderen Profil, nur damit eine Prüfung besteht.

- „Welche virtuellen Boards werden unterstützt?“
- „Prüfen Sie build/app.elf gegen stm32f4-discovery als cortex-m4 mit Boot-Adresse 0x08000000.“
- „Starten Sie die Firmware 2 virtuelle Sekunden lang auf dem virtuellen Board und zeigen Sie die UART-Ausgabe.“
- „Führen Sie den Testsatz board-basics mit Version 1.2.3 aus.“
- „Schreiben Sie einen Bericht über den virtuellen Lauf neben dem HIL-Lauf.“

## Risiko und Freigaben

Alle Operationen von renode-sim (tools, profiles, validate, run, capture-uart, test, report) sind als **Sicher** eingestuft: Sie laufen nur auf Ihrem Computer, verwenden kein Gerät, keinen Netzwerk-Listener und keine Host-Datei außerhalb des neuen Laufordners und laufen ohne Rückfrage. Das direkte Ausführen von Renode ist **Gesperrt**, weil sein Monitor Python ausführen, Skripte einbinden, Dateien herunterladen und Sockets oder Host-Geräte öffnen kann.

## Grenzen

- Windows x64 und Linux x64; natives Ubuntu ist noch nicht geprüft.
- Nur freigegebene Profile laufen; es gibt keinen Zugriff auf die Renode-Konsole, Monitor-Befehle, `.resc`-Skripte oder Robot Framework.
- Greift die Firmware auf ein Peripheriegerät zu, das das Modell nicht implementiert, ist das Ergebnis unvollständig. Das STM32F4-Modell simuliert weder den Taktbaum noch das Zyklus-Timing, DAC, ADC, USB, SDIO, DCMI oder die externen Bauteile des Boards.
- Virtuelle Zeit ist simulierte Zeit. Eine Simulation sagt nichts über elektrisches Timing, Leistungsaufnahme, EMV oder die analoge Schaltung aus.
- Eine `.repl`-Datei in der Workbench sollte wie Code geprüft werden.
