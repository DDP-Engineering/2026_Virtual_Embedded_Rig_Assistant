# ngspice-Schaltungssimulation

Dieses Plugin ermöglicht dem Agenten, Schaltungen lokal mit ngspice zu simulieren. Es führt Arbeitspunkt-, DC-, AC-, Transienten- und Rauschanalysen Ihrer SPICE-Netzliste (von Hand geschrieben oder aus KiCad exportiert) mit lokalen Modellen aus, misst über deklarierte Fenster (Welligkeit, Überschwingen, Einschwingen, Effektivwert, mittlere Leistung), prüft Bestanden/Nicht-bestanden-Kriterien, variiert Parameter und Temperatur, führt Monte-Carlo-Läufe mit festem Seed aus, vergleicht Läufe und schreibt Berichte. Netzlisten werden geprüft, bevor der Simulator läuft, und jeder Lauf schreibt unter `electronics-results/` einen neuen Ordner mit dem Log, der wirksamen Netzliste, Hashes der Eingaben, einer Datei mit Messreihen, einem Plot, einer Ergebnisdatei und einem Bericht.

## Voraussetzungen

- **ngspice 42 oder neuer.** Unter Windows lädt **Abhängigkeiten installieren** den festgelegten offiziellen Build ngspice-47 in den Programmordner von VERA herunter; VERA verwendet auch Ihre eigene Installation in `C:\Spice64`. Unter Ubuntu gibt es kein offizielles Binary: Installieren Sie es selbst mit `sudo apt install ngspice`. Der Abschnitt **Abhängigkeiten** der Plugin-Seite zeigt, was gefunden wurde.
- **ngspice-tool**, ein Python-Skript im Plugin, das VERA selbst installiert. Der Agent arbeitet immer darüber.
- Keine Hardware, keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet den Skill `circuit-simulation`. Er legt Analyse, Messfenster und Kriterien fest, bevor er sich die Ergebnisse ansieht.

- „Prüfen Sie circuits/buck.cir und listen Sie seine Modelle und Subcircuits auf.“
- „Führen Sie eine Transientenanalyse des Abwärtswandlers über 2 ms aus; die Ausgangswelligkeit von 1 ms bis 2 ms darf höchstens 50 mV betragen.“
- „Messen Sie die mittlere Leistung im Schalter von 1 ms bis 2 ms.“
- „Variieren Sie RLOAD über 1k und 3k und vergleichen Sie die Läufe.“
- „Führen Sie 50 Monte-Carlo-Läufe mit 5 % Toleranz auf RLOAD aus, Seed 7, und schreiben Sie einen Bericht.“
- „Bauen Sie ein konzentriertes thermisches RC-Netzwerk für den Regler auf und ermitteln Sie seine stationäre Temperatur.“

## Risiko und Freigaben

Alle Operationen von ngspice-tool (validate, run, sweep, measure, compare, report) sind als **Sicher** eingestuft: Sie simulieren nur auf Ihrem Computer, ändern nie die Netzliste oder ihre Modelle und laufen ohne Rückfrage. Das direkte Ausführen von ngspice ist **Gesperrt**, weil der Control-Block einer Netzliste Shell-Befehle ausführen und Dateien schreiben kann.

## Grenzen

- Windows x64 und Linux x64.
- Abgelehnt, bevor der Simulator läuft: `.control`-Blöcke, unbekannte Karten, Zeilen mit `*#` und `;#` (ngspice führt sie als Befehle aus), XSPICE-Instanzen `A`, das Laden von Code, `shell`, Includes außerhalb der Workbench, undefinierte Modelle oder Subcircuits und Subcircuit-Instanzen mit falscher Pin-Anzahl.
- Analysekarten in der Netzliste (`.tran`, `.ac`, `.meas`, `.print`) werden nicht ausgeführt; die Anfrage bestimmt die Analyse.
- Ein Lauf, der nicht konvergiert, wird gemeldet und nicht mit gelockerten Solver-Einstellungen wiederholt.
- Eine Simulation ist keine Hardwaremessung: Das Ergebnis ist nur so gut wie die Modelle.
