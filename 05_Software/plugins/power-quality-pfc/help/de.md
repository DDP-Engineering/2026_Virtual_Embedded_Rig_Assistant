# Netzqualität und Blindleistungskompensation

Netzqualität und Blindleistungskompensation gibt dem Agenten das integrierte VERA-Werkzeug `power_quality` für die Blindleistungskompensation an einer Verteilung. Es importiert P/Q/S- und Oberschwingungs-Messdateien in einem deklarierten Format und liefert je Netzszenario und gemessenem Intervall Wirkleistung und Grundschwingungs-Blindleistung, den Verschiebungsfaktor und den Gesamtleistungsfaktor unter Verzerrung, den kvar-Bedarf bis zu einem Ziel, eine feste oder automatische Anlage aus gleichen Stufen mit einem Vorschlag für die Regellogik, Überkompensation bei Schwachlast, Prüfungen von Kondensator, Verdrosselung, Kondensatorschütz und Stufenschutz gegen zitierte Katalogdaten sowie die Parallelresonanz gegen die gemessenen Oberschwingungsordnungen. Jedes Ergebnis nennt Quellen, Einheiten, Annahmen und Grenzen. Es schlägt vor; es schaltet nie eine Stufe und stellt keinen Regler ein.

## Voraussetzungen

- Keine Programme: Das Plugin bringt einen Skill mit, und der Agent nutzt das integrierte Werkzeug von VERA, das nur bei aktiviertem Plugin angeboten wird. Es gibt nichts zu installieren.
- Die Verteilung im elektrischen Projektmodell, idealerweise mit einem aktuellen Netzergebnis (Skill `network-sizing`), das P und Q der Verteilung je Szenario und die Kurzschlussleistung für die Resonanzprüfung liefert.
- Eine Messdatei mit deklarierter Zeit, Einheiten und Vorzeichenkonventionen. Sagt der Export nicht, ob Q die Grundschwingung ist oder welches Vorzeichen gilt, nennen Sie die Annahme; der Agent rät sie nie.
- Ziel und Grenzen, die nur Sie festlegen können: Ziel-Leistungsfaktor, Spannungstoleranz, Resonanzabstand, Ausgänge des Reglers. Zitierte Katalogdaten (Kondensatoren, Drosseln, Schütze, Schutz) für die Geräteprüfungen.

## Verwendung

- „Importieren Sie diesen Analysator-Export für die Hauptverteilung und zeigen Sie Verschiebungsfaktor und Gesamtleistungsfaktor.“ (Skill `power-factor-correction`)
- „Wie viele kvar brauche ich für 0,95 an dieser Verteilung, in jedem Szenario?“
- „Schlagen Sie eine feste oder automatische Anlage vor und erklären Sie warum, einschließlich Überkompensation bei der kleinsten Last.“
- „Prüfen Sie diese Kondensatoren, Drosseln und Schütze gegen den Katalog.“
- „Gerät die Anlage bei 20 MVA Kurzschlussleistung nahe einer gemessenen Oberschwingungsordnung in Resonanz?“
- „Behandeln Sie das Q in dieser Datei als Grundschwingung und vermerken Sie die Annahme im Ergebnis.“

Messdateien liegen in `electrical-automation-measurements/`, jedes Ergebnis in `electrical-automation-results/<run-id>/`; ein Ergebnis überschreibt nie ein früheres und gilt als veraltet, sobald sich das Modell ändert.

## Risiko und Freigaben

Das Werkzeug schreibt: In Sitzungen im Modus Nur lesen wird es nicht angeboten, und VERA fragt vor dem Speichern eines Ergebnisses oder einer Messdatei nach, wie bei jedem Schreiben einer Datei. Es ändert das Modell nicht, schaltet keine Kondensatorstufe und stellt keinen Regler ein. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Vorläufige Ingenieurunterstützung: kein geprüfter Entwurf, keine Konformitätserklärung und kein vollständiger Netzqualitätsbericht. Kondensatoren korrigieren nur den Verschiebungsanteil.
- Fehlende Daten bleiben unbekannt und bestehen nie: Ohne Kurzschlussleistung, Abstand oder Oberschwingungsdaten ist das Resonanzurteil unbekannt, und eine Kondensator-Drossel-Paarung wird nur aus einer zitierten Tabelle akzeptiert.
- Kein Filterentwurf, keine Schalttransienten, keine minimale Kurzschlussleistung (das Netzergebnis liefert nur das Maximum).
