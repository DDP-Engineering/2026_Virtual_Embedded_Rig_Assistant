# Motorstart und Antriebe

Motorstart und Antriebe lässt den Agenten vergleichen, wie jeder Motor Ihres elektrischen Projektmodells gestartet oder angetrieben werden kann, und bemisst, was dafür nötig ist, statt allein nach der Leistung zu wählen. Pro Motor vergleicht er Direktstart, Wendestarter, Stern-Dreieck, Sanftanlasser und drehzahlveränderbaren Antrieb mit der Prozessfunktion, der Anlaufstromgrenze, dem Beschleunigungsmoment, der Hochlaufzeit und den Starts pro Stunde. Er schlägt die einfachste bestehende Methode vor, bemisst Schütze nach Gebrauchskategorie, das Überlastrelais, einen Sanftanlasser oder einen Antrieb nach Strom und Überlast mit zitierter Leistungsminderung und liefert ein logisches Anschluss- und Verriegelungsschema. Jedes Ergebnis nennt Quellen, Einheiten, Annahmen und Grenzen.

## Voraussetzungen

- **Kein Programm.** Der Agent nutzt das eingebaute VERA-Werkzeug `motor_drives`, das nur angeboten wird, solange dieses Plugin aktiviert ist. Es gibt nichts zu installieren oder herunterzuladen, daher hat **Abhängigkeiten installieren** hier nichts zu tun.
- Ein aktuelles Ergebnis von Schutz und Koordination (Skill `protection-selection`), das seinerseits ein aktuelles Ergebnis des elektrischen Netzes braucht; veraltete werden abgelehnt.
- Der Industriekatalog mit Schützen, Überlastrelais, Sanftanlassern und Antrieben, mit zitierten Werten und Bedingungen.
- Motor- und Lastdaten im Modell (Typenschild, Momentverhältnisse, Trägheiten, Lastmoment, Starts pro Stunde) sowie die Prozessfunktion und Grenzen, die Sie mit dem Agenten vereinbaren. Fehlende Werte bleiben unbekannt; der Agent fragt nach, statt einen Typwert zu verwenden.

## Verwendung

- „Vergleichen Sie Direktstart, Stern-Dreieck und einen Antrieb für den Pumpenmotor M2.“ (Skill `motor-starting`)
- „Ist Stern-Dreieck für diesen Motor zulässig, und bleibt der Anlaufstrom in der Leitung unter der Grenze des Netzbetreibers?“
- „Wie lange braucht das Förderband zum Hochlauf, und liegt das unter der Blockierzeit?“
- „Bemessen Sie die Schütze und das Überlastrelais für die vorgeschlagene Methode.“
- „Welche Belastungsklasse des Antriebs deckt Dauer- und Überlaststrom ab, mit Leistungsminderung bei 45 °C und 1000 m?“
- „Geben Sie mir das Anschluss- und Verriegelungsschema für den Wendestarter.“

Das Ergebnis wird mit Kopien der gelesenen Motoren, Stromkreise und Kabel unter `electrical-automation-results/<run-id>/` in der Workbench gespeichert. Ändert sich das Modell danach, wird das Ergebnis als veraltet markiert.

## Risiko und Freigaben

Das Werkzeug ist ein Schreibwerkzeug: Es speichert ein neues Ergebnis und fragt wie bei einem Dateischreibvorgang nach Ihrer Freigabe. In Sitzungen im Modus Nur lesen wird es nicht angeboten. Es ändert nie das elektrische Modell und konfiguriert oder parametriert nie einen Antrieb, Sanftanlasser oder ein Relais. Es gibt keine Aktionen der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Hochlaufzeit und Momentkennlinien sind Modellwerte mit genannten Annahmen, keine garantierte Leistung.
- Fehlende Daten bleiben unbekannt und bestehen nie. Bremsenergie, EMV-Kategorie, Motorkabellänge und RCD-Typen zählen nur aus zitierten Daten; alles andere ist eine Frage an den Hersteller. Starts pro Stunde von Sanftanlassern sowie EMV-Kategorie und maximale Motorkabellänge eines Antriebs fehlen oft auf öffentlichen Seiten.
- Urteile zu Schutzgerät und Starterkoordination werden aus dem Schutzergebnis übernommen, nie aus der Überlappung von Kennlinien gelesen.
- Fixtures sind klein und zitiert; lizenzierte Herstellertabellen werden nicht mitgeliefert.
- Ergebnisse sind vorläufige Ingenieurunterstützung: Es wird kein verifizierter Entwurf, keine Konformitätserklärung und keine Sicherheitsfunktion beansprucht. Das Schema ist ein logischer Ausgangspunkt für Zeichnungen.
