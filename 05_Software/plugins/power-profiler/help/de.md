# Leistungsprofilierung

Dieses Plugin ermöglicht dem Agenten, Strom, Spannung, Leistung, Energie und Ladung eines Boards mit einem Joulescope JS220 zu messen und die Aufzeichnungen offline zu analysieren. Eine Aufzeichnung verknüpft die Daten mit dem Firmware-Build und zeichnet GPI-Marker für Ereignisse auf; Lücken und Überläufe werden nie zu null. Die Analyse liefert mittleren, minimalen und maximalen Strom, Energie und Ladung, die Zeit in Schlaf- und Aktivzuständen, die Energie pro Ereignis, einen A/B-Vergleich von Firmware-Versionen und ein Intervall für die Batterielaufzeit mit seinen Annahmen. Die Ergebnisse landen unter `embedded-lab-results/`.

## Voraussetzungen

- **power-profile** (mit pyjoulescope_driver 2.5.5) und **power-analyze**, Python-Skripte, die VERA mit **Abhängigkeiten installieren** selbst installiert.
- **Ein Joulescope JS220**, über das das Board versorgt wird. Der USB-Zugriff braucht unter Windows WinUSB oder unter Linux die udev-Regel des Herstellers, die Sie selbst einrichten.
- **Das Laborregister** `lab/resources.json` in der Workbench (erforderlich), das das Messgerät als Leistungsmonitor deklariert, zum Beispiel mit dem Alias `js1`. Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob die Datei vorhanden und gültig ist.
- Keine anderen Plugins. Ein A/B-Urteil über Firmware verwendet lab-validate aus dem Plugin lab-validation.

## Verwendung

Der Agent verwendet die Skills `power-measurement` und `energy-analysis`. Er fragt, wie das Board verdrahtet ist, welche GPIOs die GPI-Eingänge des Messgeräts erreichen und wie hoch die Versorgungsspannung ist.

- „Identifizieren Sie das Messgerät js1 und prüfen Sie Treiber und USB-Zugriff.“
- „Zeichnen Sie 20 Sekunden mit 100 kHz und Marker 0 auf, Firmware build/app.elf, Board sensor-node Rev. B bei 3,3 V.“
- „Messen Sie Energie und Ladung dieser Aufzeichnung von 2 s bis 12 s.“
- „Teilen Sie die Aufzeichnung anhand von Marker 0 in Aufwachvorgänge auf und nennen Sie die Energie pro Aufwachvorgang und den Schlafstrom.“
- „Vergleichen Sie Firmware A und B und schätzen Sie die Batterielaufzeit mit battery.json.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Prüfen der Treibervoraussetzungen und jeder Offline-Analyseschritt.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Auflisten der angeschlossenen Messgeräte und Identifizieren des Messgeräts; nichts wird verändert.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): eine Aufzeichnung, weil sie Abtastrate und Messbereich des Messgeräts einstellt, was die Bürdenspannung in Reihe mit Ihrem Board verändert (die vorherigen Einstellungen werden danach wiederhergestellt); sowie das Aufräumen durch VERA nach einer unterbrochenen Aufzeichnung.

Das Plugin schaltet nie den Strompfad des Boards, steuert nie die Ausgänge des Messgeräts an und aktualisiert nie seine Firmware.

## Grenzen

- Windows x64 und Linux x64.
- Das JS220-Profil ist noch nicht an einem echten Messgerät geprüft.
- Eine Aufzeichnung enthält höchstens 1 000 000 Abtastwerte.
- Ist der Strompfad des Messgeräts ausgeschaltet, werden Aufzeichnungen abgelehnt.
- Nicht enthalten: eine Konsole für das Messgerät, Steuerung des Strompfads, JLS-Dateien und andere Messgeräte wie PPK2 oder Otii.
