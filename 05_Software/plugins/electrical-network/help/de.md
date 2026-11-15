# Elektrisches Netz und Kabeldimensionierung

Elektrisches Netz und Kabeldimensionierung lässt den Agenten ein radiales Niederspannungsnetz des elektrischen Modells der Workbench berechnen, statt es zu schätzen. Abgedeckt sind die P/Q/S-Lastbilanz je Szenario mit Gleichzeitigkeits- und Auslastungsfaktoren, Phasen- und Neutralleiterströme, Bemessungsströme, anhand einer zitierten Kabeltabelle geprüfte oder vorgeschlagene Kabelquerschnitte, ein- und dreiphasiger Spannungsfall sowie maximale und minimale Fehlerströme nach dem Impedanzverfahren gemäß IEC 60909-0:2016. Jedes Ergebnis nennt Verfahren, Eingaben, Einheiten, Annahmen und Grenzen. Es läuft offline und berührt keine Hardware.

## Voraussetzungen

- Keine Programme und nichts zu installieren: Das Plugin hat keine. Der Agent nutzt das integrierte VERA-Werkzeug `electrical_network`, das nur angeboten wird, solange das Plugin aktiviert ist, und nie in Sitzungen im Modus Nur lesen.
- Ein elektrisches Modell in der Workbench, `electrical-automation-model.json`, mit einem Transformator oder NS-Einspeisepunkt, seinen Stromkreisen, Kabeln und Lasten.
- Eine Kabeltabelle in `electrical-automation-tables/` mit zitierten Werten. VERA liefert keine Tabelle nach IEC 60364-5-52; tragen Sie Werte aus einem Datenblatt oder einer Norm ein, die Sie besitzen.
- Verlegeart, Umgebungstemperatur, Häufung und Fehlerniveau. Der Agent fragt nach einem fehlenden Wert, statt ihn zu erfinden.

## Verwendung

- „Berechnen Sie die Lastbilanz der Hauptverteilung für den Normalbetrieb und bei gestoppter Pumpe.“ (Skill `network-sizing`)
- „Prüfen Sie die Kabelquerschnitte aller Stromkreise gegen diese Kabeltabelle.“
- „Welchen Querschnitt schlagen Sie für das Kabel zu Motor M1 vor, und welches Kriterium entscheidet?“
- „Wie groß ist der Spannungsfall am Ende des längsten Stromkreises gegenüber einer Grenze von 4 %?“
- „Wie groß sind die maximalen und minimalen Fehlerströme an der Verteilung und an den Enden der Stromkreise?“
- „Zeigen Sie das gespeicherte Ergebnis erneut und sagen Sie mir, ob es veraltet ist.“

Ein Ergebnis wird mit seinen Eingaben als neue `electrical-automation-results/<run-id>/result.json` gespeichert; eine spätere Modelländerung markiert es daher als veraltet. Ein vorgeschlagener Querschnitt ist nur ein Vorschlag; seine Übernahme läuft über eine Modelländerung, die Sie freigeben.

## Risiko und Freigaben

`electrical_network` schreibt eine einzige neue Ergebnisdatei und verlangt eine Freigabe wie ein Dateischreibvorgang. Es ändert nie das Modell, einen Schaltplan oder eine freigegebene Auswahl; das Ändern des Modells läuft über `electrical_model_change`, das ebenfalls eine Freigabe verlangt. Das erneute Anzeigen eines gespeicherten Ergebnisses mit `electrical_model` ist nur lesend. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Ein Transformator (Dyn für Erdschlüsse) oder NS-Einspeisepunkt, dreiphasiger Wechselstrom bis 1000 V, radiale Speisung, ein Kabel je Stromkreis. Vermaschte Netze, Sammelschienenkupplungen, parallele Kabel, Generatoren, USV, PV und Gleichstrom werden nicht ausgewertet oder blockieren den Lauf.
- Fehlende Daten bleiben unbekannt und gelten nie als bestanden; nicht unterstützte Quellen oder Topologien werden nicht ausgewertet. Faktoren werden am nächsten tabellierten Punkt entnommen, nie interpoliert.
- Die Fixtures sind klein und zitiert; es werden keine IEC-Tabellen und keine vollständigen Herstellerkataloge mitgeliefert. Eine Tabelle ohne Reaktanz braucht einen vereinbarten Annahmewert, der als Annahme festgehalten wird.
- Die Ergebnisse sind vorläufige Ingenieurunterstützung, kein verifiziertes Design, keine Konformitätserklärung und keine Sicherheitszertifizierung. Auswahl der Schutzgeräte, Abschaltzeiten und Selektivität gehören zur Schutzkoordination.
