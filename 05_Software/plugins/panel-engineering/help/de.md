# Schaltschrankplanung

Mit der Schaltschrankplanung plant und prüft der Agent einen Steuerschrank neben dem elektrischen Projektmodell. Sie beschreiben Gehäuse und Montageplatte, Tragschienen, Kanäle, Zonen mit Ihren Regeln, die Betriebsmittel, Klemmleisten, die 24-V-Versorgung, Szenarien, Reserve und thermische Bedingungen in einer Schrankdatei; die Prüfung gleicht die Betriebsmittelliste mit den Motorstartern, dem Modell und Ihren QElectroTech-Plänen ab, setzt jedes Gerät mit seinen echten Maßen auf die Schienen, bilanziert die 24-V-Versorgung und schätzt die Lufttemperatur im Gehäuse.

## Was es braucht

- **Kein Programm.** Der Agent nutzt die eingebauten VERA-Werkzeuge `panel_engineering` und `panel_engineering_check`, die nur angeboten werden, solange dieses Plugin aktiviert ist. Es gibt nichts zu installieren oder herunterzuladen, daher hat **Abhängigkeiten installieren** hier nichts zu tun.
- Ein aktuelles Motorstart-Ergebnis (Plugin Motor starting and drives) und Industriekataloge mit Maßen, Verlusten und Zubehör der Geräte (Plugin Industrial catalog and documented selection).
- Optional die QElectroTech-Pläne der Motoren (Plugin QElectroTech schematics).

## So nutzen Sie es

- „Entwirf die Schrankbetriebsmittel für M1 und M2 aus dem letzten Motorergebnis." (Skill `panel-engineering`)
- „Schreibe die Schrankdatei für MCP1: Gehäuse 600 x 400 x 200 an der Wand, drei Schienen, eine 24-V-Versorgung für die SPS."
- „Prüfe den Schrank gegen das Motorergebnis und die beiden Pläne."
- „Welche Geräte konnten nicht platziert werden, und warum?"
- „Ich habe KM1-M1 ersetzt - was muss ich neu machen?"
- „Exportiere die Stückliste als CSV und den Aufbau als SVG."

Das Ergebnis wird in `electrical-automation-results/<run-id>/` mit den Hashes der Schrankdatei, der Kataloge und der Pläne gespeichert; ändert sich das Modell, wird es als veraltet markiert.

## Risiko und Freigaben

`panel_engineering` liest nur. `panel_engineering_check` ist ein Schreibwerkzeug: Es fragt wie ein Dateischreibvorgang nach Ihrer Freigabe und wird in Nur-Lesen-Sitzungen nicht angeboten. Es schreibt nur seine neue Ergebnisdatei; Modell, Schrankdatei, Kataloge und Pläne bleiben unverändert. Es gibt keine Geräte-Lese-, Geräte-Schreib- oder irreversiblen Aktionen.

## Grenzen

- Zubehör gilt nur als kompatibel, wenn der Katalog es für das Trägergerät nennt; sonst bleibt es offen.
- Ein fehlendes Maß oder ein fehlender Verlust bleibt unbekannt: Das Gerät wird nicht platziert und die Verlustleistung nicht summiert, niemals als null gezählt.
- Die Lufttemperatur ist die Wärmebilanz des Gehäuses aus dem Gehäusekatalog von Schneider Electric (Mittelwert, Verluste bei Bemessungswerten); oben im Gehäuse ist es wärmer.
- Die Kurzschlussfestigkeit braucht den erklärten Bemessungswert der Baugruppe; Sammelschienen werden nicht bewertet.
- Keine IEC-61439-Konformität wird erklärt, kein 3D-Aufbau und keine Bearbeitungsdaten. Geprüft unter Windows x64 und WSL2; noch nicht auf nativem Ubuntu x64 ausgeführt.
- Ergebnisse sind vorläufige Ingenieurunterstützung: kein geprüfter Entwurf und keine Sicherheitsfunktion.
