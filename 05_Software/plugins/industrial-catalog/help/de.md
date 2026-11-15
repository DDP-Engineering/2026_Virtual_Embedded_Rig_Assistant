# Industriekatalog und dokumentierte Auswahl

Industriekatalog und dokumentierte Auswahl lässt den Agenten Niederspannungsgeräte anhand von Herstellernachweisen auswählen, statt aus dem Gedächtnis oder nach dem Produkttext eines Händlers. Abgedeckt sind Schütze, Motorschutzschalter, Schutzgeräte, Antriebe, SPS- und E/A-Module sowie Zubehör. Kataloge sind Dateien in der Workbench, die Bestellnummer des Herstellers, Variante und Zubehör getrennt von den Artikelnummern der Händler führen; jeder Parameter ist mit Quelle, Revision und Seite oder Tabelle unter seinen Bedingungen belegt. Der Agent wählt anhand Ihrer festen Anforderungen aus, erklärt jeden Ausschluss und nennt Quellen, Einheiten und Grenzen. Er läuft offline und berührt keine Hardware.

## Voraussetzungen

- Keine Programme und nichts zu installieren: Das Plugin hat keine. Der Agent nutzt das integrierte VERA-Werkzeug `industrial_catalog`, das nur angeboten wird, solange das Plugin aktiviert ist.
- Ein Katalog in `electrical-automation-catalogs/` in der Workbench. Sie oder der Agent können einen mit einem gewöhnlichen, freigegebenen Dateischreibvorgang anlegen oder importieren; eine defekte Datei wird aufgelistet, ohne die anderen zu stoppen.
- Ihre Anforderungen mit ihren Bedingungen: Spannung, Gebrauchskategorie, Umgebungstemperatur. Der Agent fragt nach einer fehlenden Angabe, statt eine Reserve anzunehmen.
- Keine benötigten Plugins, keine Hardware und keine Konfiguration.

## Verwendung

- „Welche Schütze im Katalog passen zu einem 4-kW-Motor mit 400 V in AC-3 und 230-V-Spule?“ (Skill `industrial-selection`)
- „Finden Sie den Artikel mit der Bestellnummer LC1D09P7 und sagen Sie mir, ob meine Nummer eine Bestellnummer oder eine Händler-Artikelnummer ist.“
- „Welche Motorschutzschalter beherrschen 20 kA bei 400 V und lassen sich auf 8,5 A einstellen?“
- „Warum wurde dieser Artikel ausgeschlossen, und welche Werte sind noch unbekannt?“
- „Gilt die Sicherungskoordination für diese beiden genauen Produkte bei 400 V?“
- „Schlagen Sie dieses Schütz für das Modell mit Hersteller und Bestellnummer vor, mit dem Katalog als Quelle.“

Jedes Ergebnis lautet geeignet, unbekannt oder ausgeschlossen, und jeder Wert wird mit seinen Bedingungen und seiner Quelle zitiert. Ein niedrigerer Preis, mehr Lagerbestand oder ein ähnlicher Name machen zwei Artikel nie gleichwertig. Der Agent schreibt nie von selbst in den Katalog.

## Risiko und Freigaben

Das Werkzeug `industrial_catalog` liest nur Dateien: Es verlangt keine Freigabe, schlägt nichts live nach und speichert nichts. Das Schreiben eines Katalogs oder eine Modelländerung, die Ihre Wahl festhält (`electrical_model_change`), verlangt eine Freigabe wie jeder Dateischreibvorgang. Nichts wird von Webseiten abgegriffen, bestellt oder in einem Schaltplan ersetzt; es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Fehlende oder unbestätigte Werte bleiben unbekannt und gelten nie als bestanden. Ein als extrahiert markierter Wert ist nicht gegen die Quelle geprüft und entscheidet nie über eine Anforderung.
- Koordinationstabellen gelten nur für die genauen Produkte, die Spannung und die Bedingungen, die sie nennen; sonst bleibt die Koordination unbekannt.
- Es werden keine vollständigen Herstellerkataloge und keine IEC-Tabellen mitgeliefert. Das enthaltene Fixture ist klein und zitiert, einige Schütze und Motorschutzschalter von öffentlichen Produktseiten, lizenzierte Koordinationstabellen der Hersteller sind nicht enthalten. Tragen Sie nur Werte ein, die Sie verwenden dürfen, und vermerken Sie die Lizenzbedingungen jeder Quelle.
- Live-Preise und Lagerbestände kommen vom Plugin parts-search und sind nur kommerzielle Informationen. Eine Auswahl ist ein Vorschlag, keine Designfreigabe.
