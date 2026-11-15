# LTspice-Schaltungssimulation

Dieses Plugin ermöglicht dem Agenten, Schaltungen im Batch-Modus mit Ihrer eigenen LTspice-Installation unter Windows zu simulieren. Es führt Arbeitspunkt-, DC-, AC-, Transienten- und Rauschanalysen einer SPICE-Netzliste oder eines LTspice-Schaltplans (.asc) aus, variiert Parameter und Temperatur schrittweise, führt Monte-Carlo-Läufe mit festem Seed aus, misst über deklarierte Fenster (Welligkeit, Überschwingen, Einschwingen, Effektivwert, mittlere Leistung) und prüft Bestanden/Nicht-bestanden-Kriterien. Anfragen verwenden dasselbe Format wie das Plugin ngspice, sodass eine Anfrage auf beiden Simulatoren laufen kann und sich die Ergebnisse vergleichen lassen. Jeder Lauf schreibt unter `electronics-results/` einen neuen Ordner mit den Eingaben, dem Log und der Raw-Datei von LTspice, einem Plot und einem Bericht.

## Voraussetzungen

- **LTspice 26 oder neuer**, das Sie selbst von https://www.analog.com/ltspice installieren (LTspice64.msi, Windows 10/11 x64). VERA findet es im Installationsordner pro Benutzer oder für alle Benutzer und installiert es nie. Schlägt die Installation pro Benutzer mit Fehler 2503 fehl, installieren Sie es aus einer Administrator-Eingabeaufforderung für alle Benutzer: `msiexec /i LTspice64.msi ALLUSERS=1`.
- **ltspice-tool**, ein Python-Skript im Plugin, das VERA selbst installiert. Der Agent arbeitet immer darüber.
- Keine Hardware, keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet den Skill `ltspice-simulation`.

- „Prüfen Sie circuits/buck.cir und seine Includes, bevor wir es simulieren.“
- „Konvertieren Sie circuits/filter.asc in eine Netzliste und führen Sie einen AC-Sweep von 10 Hz bis 100 kHz aus; der -3-dB-Punkt muss über 159 Hz liegen.“
- „Führen Sie eine Transientenanalyse des Abwärtswandlers aus und messen Sie die Ausgangswelligkeit nach dem Einschwingen.“
- „Führen Sie 50 Monte-Carlo-Läufe mit 5 % Toleranz auf RLOAD aus, Seed 7.“
- „Führen Sie dieselbe Anfrage mit ngspice aus und vergleichen Sie die Messwerte.“

## Risiko und Freigaben

Alle Operationen von ltspice-tool (validate, convert, run, sweep, measure, compare, report) sind als **Sicher** eingestuft: Sie simulieren nur auf Ihrem Computer, ändern nie die Netzliste, den Schaltplan, seine Modelle oder die Bibliotheken von LTspice und laufen ohne Rückfrage. Das direkte Ausführen von LTspice ist **Gesperrt**, weil eine Netzliste überall Dateien schreiben kann und LTspice ohne Batch-Modus sein Fenster öffnet.

## Grenzen

- Nur Windows x64; das Plugin wird unter Linux und macOS nicht angeboten.
- Bevor LTspice läuft, lehnt ltspice-tool Direktiven ab, die Dateien lesen oder schreiben (etwa `.wave`), ebenso unbekannte Karten, verschlüsselte oder nicht UTF-8-codierte Dateien und Includes außerhalb der Workbench und der LTspice-Bibliothek. Auch ein Knoten mit einem Namen wie `profile` wird abgelehnt, weil LTspice `file` als Präfix erkennt.
- Analyse- und `.meas`-Karten in der Netzliste werden nicht ausgeführt; die Anfrage bestimmt die Analyse.
- Ein Bibliotheksabschnitt braucht einen Dateinamen in Anführungszeichen: `.lib "models/corners.lib" TT`.
- Eine Simulation ist keine Hardwaremessung: Das Ergebnis ist nur so gut wie die Modelle.
