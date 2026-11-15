# KiCad-Schaltplan- und PCB-Analyse

KiCad-Schaltplan- und PCB-Analyse ermöglicht dem Agenten, KiCad-10-Projekte zu analysieren, ohne sie zu ändern. Er liest die Blatthierarchie, Symbolinstanzen, Netze, Platinenlagen, den Lagenaufbau, Leiterbahnen und Netzklassen; führt ERC und DRC von KiCad aus und meldet jede Verletzung mit ihren Objekten und Positionen; und erzeugt eine Stückliste, die Netzliste von KiCad sowie Prüf- oder Fertigungsexporte (Schaltplan und Platine als PDF oder SVG, Gerber-, Bohr- und Bestückungsdateien), jeweils geprüft. KiCad läuft nur auf einer Kopie des Projekts. Jeder Lauf legt in der Workbench unter `electronics-results/` einen Ordner mit `result.json`, `report.md` und KiCads eigenen Dateien an.

## Voraussetzungen

- **KiCad 10**, das Sie selbst von https://www.kicad.org/download/ installieren (unter Ubuntu aus dem KiCad-10-PPA). Verwenden Sie dann **Abhängigkeiten prüfen** auf der Plugin-Seite.
- **kicad-tool**: ein Skript im Plugin, das **Abhängigkeiten installieren** automatisch installiert.
- Ein KiCad-Projekt (`.kicad_pro`, `.kicad_sch` oder `.kicad_pcb`) in der Workbench. Dateien aus KiCad 8 oder 9 laufen mit einer Warnung; ältere oder neuere Dateien werden abgelehnt und müssen zuerst in KiCad 10 gespeichert werden.
- Keine benötigten Plugins und keine Konfigurationsparameter.

## Verwendung

- „Prüfen Sie den Schaltplan von hardware/sensor.kicad_pro.“ (Skill `schematic-review`)
- „Führen Sie ERC aus und listen Sie die Verletzungen mit ihren Blättern und Positionen auf.“
- „Führen Sie DRC auf der Platine mit neu gefüllten Zonen aus und prüfen Sie die Übereinstimmung mit dem Schaltplan.“ (Skill `pcb-review`)
- „Exportieren Sie die Stückliste und die Netzliste.“
- „Erstellen Sie die Gerber-, Bohr- und Bestückungsdateien für eine zweilagige Platine.“

In einem Review hält der Agent die Befunde von KiCad von seinen eigenen Beobachtungen getrennt und kennzeichnet jede Beobachtung als Tatsache oder Hypothese. Er bezeichnet ein Netz oder ein Bauteil nicht als ausreichend dimensioniert, ohne die zugrunde liegenden elektrischen Anforderungen zu kennen. Null DRC-Verletzungen belegen weder Funktion noch Strombelastbarkeit, Impedanz oder Rückstrompfade.

## Risiko und Freigaben

- Sicher, läuft in jedem Berechtigungsmodus ohne Rückfrage: alle `kicad-tool`-Operationen. Sie arbeiten auf einer temporären Kopie und legen nur neue Laufordner an; das Projekt wird nie geändert, und ein Lauf, dessen Quellen sich zwischenzeitlich geändert haben, wird verworfen.
- Gesperrt: das direkte Ausführen von `kicad-cli`, außer Version oder Hilfe, weil es Dateien im gelesenen Projektordner neu schreibt und ein Projekt speichern oder aktualisieren kann.

Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft mit KiCad 10.0.8 unter Windows 11; natives Ubuntu x64 steht noch aus.
- ERC und der Review-Bericht lehnen ein Projekt ab, bei dem die ERC-Prüfung der Simulationsmodelle eingeschaltet ist; setzen Sie diese Prüfung auf Ignorieren.
- Keine Änderungen an Schaltplan oder Platine (siehe Plugin kicad-layout), kein 3D-Modell-Export, keine Jobsets und keine Aktualisierungen.
- Referenz: https://docs.kicad.org/10.0/en/cli/cli.html
