# SCPI-Labormessgeräte

Dieses Plugin ermöglicht dem Agenten, über PyVISA mit den Labormessgeräten zu arbeiten, die Ihre Workbench deklariert: einem Multimeter, einem Oszilloskop oder einem Netzgerät. Es identifiziert ein Messgerät, liest Werte mit Einheiten, zeichnet Signalverläufe auf, ändert Einstellungen und versorgt ein Board für eine begrenzte Haltezeit über einen Ausgang eines Netzgeräts. Jeder Befehl stammt aus einem Profil des Pakets; es gibt kein Raw-SCPI und keine Netzwerksuche. Jedes Messgerät wird für den Lauf reserviert, und seine Ausgänge werden nach Stoppen, einer Zeitüberschreitung oder einem Absturz ausgeschaltet, oder der Zustand wird als unbekannt gemeldet. Die Ergebnisse landen unter `embedded-lab-results/`.

## Voraussetzungen

- **scpi**, ein Python-Skript mit festgelegtem PyVISA 1.16.2 und pyvisa-py 0.8.1, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- **Das Laborregister** `lab/resources.json` in der Workbench (erforderlich). Jeder Eintrag hat einen Alias, die VISA-Ressource, die Seriennummer, das Profil und Laborgrenzwerte. Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob die Datei vorhanden und gültig ist.
- **Unterstützte Messgeräte**: Keysight 34460A/34461A, Rigol DS1054Z/DS1074Z/DS1104Z (und Plus), Rigol DP832/DP832A, über TCPIP, USBTMC oder (DP800) seriell.
- Für USBTMC: libusb 1.0 und Gerätezugriff, die Sie selbst einrichten (unter Ubuntu `libusb-1.0-0` und eine udev-Regel; unter Windows ein WinUSB-Treiber, zum Beispiel mit Zadig). Optional eine VISA-Bibliothek eines Herstellers (NI-VISA, Keysight IO Libraries).

## Verwendung

Der Agent verwendet die Skills `bench-instruments` und `instrument-profiles`.

- „Identifizieren Sie das Netzgerät psu und zeigen Sie seine Grenzwerte.“
- „Lesen Sie die Gleichspannung am Multimeter dmm, Messbereich 10 V.“
- „Zeichnen Sie CHAN1 des Oszilloskops mit 1 ms/div und 0,5 V/div auf.“
- „Versorgen Sie das Board über psu CH1 mit 3,3 V, 0,2 A für 10 Minuten, während Sie es flashen.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Profil- und Registerinformationen sowie das Neuberechnen einer Aufzeichnung; kein Messgerät wird geöffnet.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Auflisten lokaler serieller Ports und USB-Geräte, identify, read, status und capture (das nur die Übertragung des Signalverlaufs einstellt, nicht die Erfassung).
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Ändern von Einstellungen und Ausschalten aller Ausgänge (auch beim Aufräumen durch VERA).
- **Irreversibel** (fragt nach, und Sie geben das Bestätigungswort `output` ein): Einschalten eines Netzgeräteausgangs für die Haltezeit; er wird danach ausgeschaltet und zurückgelesen. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

## Grenzen

- Windows x64 und Linux x64. Noch kein Profil ist an einem echten Messgerät geprüft, daher trägt ein Ergebnis, das Einstellungen geändert oder einen Ausgang eingeschaltet hat, die Warnung `profile-unverified`; natives Ubuntu und Hersteller-VISA sind noch nicht ausgeführt.
- Ein Messgerät, dessen Identität zu keinem Profil passt, erhält nur identify.
- VERA kann andere Programme nicht aussperren, und nichts kann einen Ausgang ausschalten, wenn der ganze Computer oder VERA ausfällt.
