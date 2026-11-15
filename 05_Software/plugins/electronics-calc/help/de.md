# Elektronikberechnungen

Elektronikberechnungen gibt dem Agenten einen Rechner für die Zahlen, auf denen eine Designentscheidung beruht, sodass er die Berechnung ausführt, statt zu schätzen. Abgedeckt sind das ohmsche Gesetz, Reihen-, Parallel- und Shunt-Widerstände, Spannungsteiler, RC-Zeitkonstanten, Filter und Signalformen, Verluste in Linearreglern, Widerständen, MOSFETs, Dioden, Kondensatoren und Induktivitäten, Leistungsbudgets, Sperrschicht-, Gehäuse- und Kühlkörpertemperaturen, transiente Foster-Netzwerke sowie Worst-Case- und Monte-Carlo-Toleranzanalysen. Jedes Ergebnis nennt Einheiten, Formeln, Annahmen, Grenzen und Prüfungen. Es läuft offline und berührt keine Hardware.

## Voraussetzungen

- **elec-calc**: ein Skript auf Basis der Python-Standardbibliothek, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert. Nichts wird heruntergeladen.
- Die Eingabewerte mit ihren Einheiten, idealerweise mit Datenblattquelle und Bedingungen zu jedem Wert. Der Agent fragt nach einem fehlenden Wert, statt ihn zu erfinden, aus einem Diagramm abzulesen oder auf andere Bedingungen umzurechnen.
- Keine benötigten Plugins, keine Hardware und keine Konfiguration.

## Verwendung

- „Welcher obere Widerstand ergibt 3,3 V aus 5 V mit einem unteren Widerstand von 10 kΩ?“ (Skill `electronics-sizing`)
- „Wie viel Verlustleistung hat der LDO bei 12 V Eingang, 3,3 V Ausgang, 300 mA und 5 mA Ruhestrom?“
- „Bleibt die Sperrschicht des Reglers bei 40 °C Umgebungstemperatur und thetaJA 50 K/W auf einer JEDEC-2s2p-Platine unter 125 °C?“ (Skill `thermal-analysis`)
- „Welchen Kühlkörper brauche ich für 10 W bei 50 °C Umgebungstemperatur?“
- „Prüfen Sie den Teilerausgang mit 1-%-Widerständen und 4,9–5,1 V Eingangsspannung, im Worst Case und mit Monte Carlo.“
- „Speichern Sie diese Berechnungen der Leistungsstufe als Bericht.“

Ein Bericht wird in der Workbench unter `electronics-results/<run-id>/` als `report.json` und `report.md` abgelegt; er überschreibt nie einen vorhandenen Lauf.

## Risiko und Freigaben

Jeder Befehl dieses Plugins ist sicher und läuft in jedem Berechtigungsmodus ohne Rückfrage, auch in Nur lesen. Berechnungen lesen ihre Anfrage und ändern keine Datei; nur `report` legt einen neuen Ergebnisordner in der Workbench an. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Die Toleranzanalyse verarbeitet bis zu 6 Ausgänge, 12 Parameter und 100.000 Monte-Carlo-Stichproben; ein großer Lauf kann etwa eine Minute dauern. Die Eckpunktanalyse findet die Extremwerte nur dort, wo ein Ausgang in jedem Parameter monoton ist, und das Ergebnis sagt, wo das nicht gilt.
- thetaJA wird nie mit Sperrschicht-Gehäuse-Widerständen kombiniert; es beschreibt bereits den ganzen Pfad auf seiner Testplatine (siehe https://www.ti.com/lit/an/spra953d/spra953d.pdf).
- Keine thermische Zertifizierung, kein CFD oder FEM, keine Cauer-Netzwerke, keine thermische Überlagerung wiederholter Pulse, keine Abschätzung magnetischer Kernverluste und keine Isolationsbemessung.
