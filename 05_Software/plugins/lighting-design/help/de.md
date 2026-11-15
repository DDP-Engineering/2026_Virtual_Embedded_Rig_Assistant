# Beleuchtungsplanung

Beleuchtungsplanung gibt dem Agenten das integrierte VERA-Werkzeug `lighting_design` für die Innenbeleuchtung eines rechteckigen Raums. Die vorläufige Stufe liest IES-LM-63- oder EULUMDAT-Photometrie und liefert eine Schätzung nach dem Wirkungsgradverfahren mit zitierten Nutzungsgraden, die nötigen Leuchten, die installierte Leistung und den Direktanteil auf dem Berechnungsraster, mit Diagnosen für falsche Längeneinheit, Maßstab, Ausrichtung oder Photometrie. Die Verifikationsstufe prüft einen DIALux-evo-Bericht, den Sie für denselben Raum exportieren, und gibt erst dann Urteile zu Wartungswert der Beleuchtungsstärke, Gleichmäßigkeit und Blendung. Jedes Ergebnis nennt Quellen, Einheiten, Annahmen und Grenzen. VERA schreibt keine DIALux-Datei und führt DIALux nicht aus.

## Voraussetzungen

- Keine Programme: Das Plugin bringt einen Skill mit, und der Agent nutzt das integrierte Werkzeug von VERA, das nur bei aktiviertem Plugin angeboten wird. Es gibt nichts zu installieren.
- Ein Beleuchtungsprojekt, das der Agent mit Ihnen schreibt: die deklarierte Längeneinheit, der Raum, Reflexionsgrade, die Berechnungsebene, der Wartungsfaktor mit Quelle, Leuchtentypen, Positionen und Ausrichtungen sowie die von Ihnen aus der geltenden Norm eingetragenen Anforderungen mit ihrer Quelle.
- Die unveränderten `.ies`- oder `.ldt`-Dateien des Herstellers und die Nutzungsgrade aus der Herstellertabelle. Der Agent fragt, woher die Dateien stammen, und lädt nie eine ohne Ihr Einverständnis herunter.
- Für die Verifikation: DIALux evo unter Windows, wo Sie denselben Raum aus den Projektwerten und denselben Photometriedateien aufbauen, berechnen und den Bericht exportieren.

## Verwendung

- „Schreiben Sie ein Beleuchtungsprojekt für dieses Büro mit 8 mal 6 m aus diesen IES-Dateien und prüfen Sie das vorläufige Ergebnis.“ (Skill `lighting-design`)
- „Wie viele dieser Leuchten brauche ich für 500 lx Wartungswert?“
- „Warum wirkt der Direktanteil so niedrig? Prüfen Sie die Diagnosen zu Einheit, Neigung und Drehung.“
- „Vergleichen Sie Lichtstrom und Leistung aus dem Katalog mit der Photometriedatei.“
- „Führen Sie mich durch die Schritte in DIALux evo, um diesen Raum nachzubauen.“
- „Prüfen Sie den exportierten DIALux-Bericht gegen das Projekt und nennen Sie dann die Urteile zu Gleichmäßigkeit und Blendung.“

Projekt-, Photometrie- und Berichtsdateien liegen in `electrical-automation-lighting/` und `electrical-automation-photometry/`; jedes Ergebnis liegt in `electrical-automation-results/<run-id>/` und überschreibt nie ein früheres.

## Risiko und Freigaben

Das Werkzeug schreibt: In Sitzungen im Modus Nur lesen wird es nicht angeboten, und VERA fragt vor dem Speichern eines Ergebnisses oder einer Projektdatei nach, wie bei jedem Schreiben einer Datei. Es ändert keine andere Datei und startet kein Programm. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64. Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Die vorläufige Stufe ist eine Schätzung, nie ein detailliertes photometrisches Urteil: Wartungswert der Beleuchtungsstärke, Gleichmäßigkeit und UGR bleiben nicht bewertet, bis ein passender Engine-Bericht geprüft ist. VERA berechnet Gleichmäßigkeit und UGR nicht selbst.
- Fehlende Daten bleiben unbekannt und bestehen nie. Ein Bericht, der nicht zum Projekt passt, wird abgelehnt; korrigiert wird das Modell in DIALux, nie der Eintrag.
- Notbeleuchtung und Außenbeleuchtung werden in dieser Version nicht unterstützt. Die Photometrie muss IES LM-63 Typ C oder EULUMDAT sein; andere Dateien werden mit Begründung abgelehnt.
