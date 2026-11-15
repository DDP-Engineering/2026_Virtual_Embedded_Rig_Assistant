# Zephyr-Builds, -Tests und -Flashen

Dieses Plugin ermöglicht dem Agenten, Zephyr-RTOS-Anwendungen für ein exaktes Board zu bauen, Twister-Testszenarien zu bauen und ein Board über geprüfte Operationen zu flashen. Der Agent schreibt eine explizite Anfrage: den west-Workspace mit jedem Projekt in seiner festgelegten Revision, den SDK-Ordner, die Anwendung, das Board, Konfigurationsdateien und seinen eigenen Build-Ordner. Builds bewahren die Firmware-Dateien mit Hashes, Konfiguration, Devicetree und Map-Datei auf. Nicht aufgeführte Projekte, Erweiterungsbefehle und Build-Hooks werden abgelehnt, sofern Sie sie nicht über ihren Hash freigeben. Die Ergebnisse landen unter `embedded-lab-results/`.

## Voraussetzungen

- **Zwei Python-Hilfsprogramme** mit festgelegtem west 1.5.0, CMake 4.4.4 und Ninja 1.13.2, die VERA mit **Abhängigkeiten installieren** selbst installiert.
- **Ein Zephyr SDK 1.0.1 oder neuer**, das Sie selbst installieren, mit der GNU-Toolchain Ihres Boards in seinem Ordner `gnu/`.
- **Ein west-Workspace** mit Zephyr 4.4 oder 4.5, eingerichtet von Ihnen oder vom Agenten in einem separat freigegebenen Netzwerkschritt. Halten Sie Pfade unter Windows kurz.
- Zum Flashen: **STM32CubeProgrammer**, das Sie selbst von https://www.st.com/en/development-tools/stm32cubeprog.html installieren (ein ST-Konto ist erforderlich), eine ST-LINK-Probe und das Laborregister `lab/resources.json`, das die Probe über einen Alias deklariert (optional; für Builds und Tests nicht nötig). Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob es vorhanden und gültig ist.

## Verwendung

Der Agent verwendet den Skill `zephyr-builds`. Er bearbeitet nie `.conf`-, Overlay- oder Kconfig-Dateien, damit ein Build durchläuft.

- „Untersuchen Sie den Workspace D:/zw für apps/blinky auf stm32f4_disco.“
- „Bauen Sie blinky und nennen Sie die Speicherbelegung.“
- „Bauen Sie das Twister-Szenario foo.basic und führen Sie es auf dem Renode-Board STM32F4 Discovery aus.“
- „Flashen Sie den letzten Build über die Probe stlink1; die Firmware steuert keine Aktoren an.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Untersuchen, Melden von Artefakten, Auswerten von Testläufen und Auflisten von Unterschieden; kein Build, kein Projektcode und kein Netzwerk.
- **Gerät schreiben** (fragt in den Modi **Nachfragen** und **Auto-Edit** nach): Bauen und Test-Bauen, weil Code aus Workspace und Anwendung auf Ihrem Computer läuft (eine Freigabe ist keine Sandbox); Leeren des Build-Ordners; Vorbereiten des Workspace, der einzige Netzwerkschritt; und Flashen, das den Flash des Targets überschreibt.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Flashen von Firmware, die nach dem Start Aktoren ansteuert. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.
- **Gesperrt**: der direkte Aufruf von STM32_Programmer_CLI; verwenden Sie die Flash-Operation oder das Plugin stm32-cubeprog.

## Grenzen

- Windows x64 und Linux x64. Geprüft mit Zephyr 4.4.2, SDK 1.0.1 und `stm32f4_disco` unter Windows x64; natives Ubuntu und ein echtes Board sind noch nicht geprüft.
- Das Flashen unterstützt nur den Runner `stm32cubeprogrammer`. Live-Debugging gehört zum Plugin gdb-debug.
- Twister läuft nur als Build; ein reines Build-Ergebnis ist nie ein Bestehen.
