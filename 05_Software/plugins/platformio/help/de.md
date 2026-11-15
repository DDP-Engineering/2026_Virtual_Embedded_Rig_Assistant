# PlatformIO-Projekte

Dieses Plugin ermöglicht dem Agenten, bestehende PlatformIO-Projekte über geprüfte Operationen zu untersuchen, zu bauen, zu testen und hochzuladen. Der Agent schreibt eine explizite Anfrage, die den Projektordner, die Umgebung, einen PlatformIO-Core-Ordner und seinen eigenen Build-Ordner nennt. Extra-Skripte, Bibliotheksskripte und eigene Test-Runner werden abgelehnt, sofern Sie sie nicht über ihren Hash freigeben, und Builds bewahren die Firmware-Dateien mit Hashes, Versionen und Logs auf. Der Agent führt `pio` nie direkt aus.

## Voraussetzungen

- **Zwei Python-Hilfsprogramme** mit einem festgelegten PlatformIO Core 6.2.0, die VERA mit **Abhängigkeiten installieren** selbst installiert. Ihr eigenes `pio` wird nicht verwendet.
- **Ein PlatformIO-Core-Ordner**: ein beliebiger leerer Ordner Ihrer Wahl. Ein separat freigegebener Netzwerkschritt füllt ihn mit Paketen; Builds und Tests laufen danach offline.
- **Ein Host-Compiler** für `native`-Umgebungen, den Sie selbst installieren: GCC unter Linux, ein MinGW-w64-GCC unter Windows.
- Für Uploads: eine ST-Link-Probe und das Laborregister `lab/resources.json` in der Workbench, das die Probe über einen Alias deklariert (optional; für Builds und native Tests nicht nötig). Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob es vorhanden und gültig ist.
- Es werden keine anderen Plugins benötigt.

## Verwendung

Der Agent verwendet den Skill `platformio-projects`. Er fragt Sie, welche Umgebung er verwenden soll, und bearbeitet nie platformio.ini oder Ihren Code, damit ein Build durchläuft.

- „Untersuchen Sie firmware/board demo und zeigen Sie die wirksamen Optionen der Umgebung disco.“
- „Bereiten Sie die Pakete für die Umgebung disco in D:/pio-core vor.“
- „Bauen Sie die Umgebung disco und nennen Sie die Speicherbelegung.“
- „Führen Sie die nativen Unity-Tests test_lines auf diesem Computer aus.“
- „Laden Sie den letzten Build über die Probe stlink1 auf das Board hoch; die Firmware steuert keine Aktoren an.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Untersuchen des Projekts und der Umgebungen, Melden von Artefakten und Auswerten von Testläufen. Diese starten keinen Build, keinen Projektcode und keinen Netzwerkzugriff.
- **Gerät schreiben** (fragt in den Modi **Nachfragen** und **Auto-Edit** nach): Bauen und Testen, weil Projektcode auf Ihrem Computer läuft (eine Freigabe ist keine Sandbox); Leeren der Build-Ordner von VERA; Vorbereiten der Pakete, der einzige Netzwerkschritt; und Hochladen, das den Flash des Targets überschreibt.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): ein Upload von Firmware, die nach dem Start Aktoren ansteuert. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

Während eines Uploads reserviert VERA die Probe.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64 mit der Plattform ststm32 (disco_f407vg) und der Plattform native; Uploads auf echte Boards und natives Ubuntu sind noch nicht geprüft.
- Uploads unterstützen nur das Protokoll `stlink`.
- Gerätetests werden hier nur gebaut; ihr Urteil braucht einen Renode- oder HIL-Lauf desselben ELF.
