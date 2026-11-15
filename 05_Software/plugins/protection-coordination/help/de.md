# Schutz und Koordination

Schutz und Koordination lässt den Agenten Schmelzsicherungen und Leistungsschalter für die Stromkreise Ihres elektrischen Projektmodells prüfen, statt sie nach Augenmaß zu beurteilen. Für jeden Kandidaten prüft er Bemessungsspannung, Polzahl, Ausschaltvermögen der vom Profil genannten Art (Icu, Ics oder Icn), Ib <= In <= Iz, I2 <= 1,45 Iz, automatische Abschaltung anhand zitierter Auslösebänder, Durchlassenergie gegen k²S² sowie RCD-Typ und Empfindlichkeit. Selektivität, Back-up-Schutz und Starterkoordination stammen nur aus den Herstellertabellen für genau diese Produkte. Jedes Ergebnis nennt Quellen, Einheiten, Bedingungen und Grenzen.

## Voraussetzungen

- **Kein Programm.** Der Agent nutzt das eingebaute VERA-Werkzeug `protection_coordination`, das nur angeboten wird, solange dieses Plugin aktiviert ist. Es gibt nichts zu installieren oder herunterzuladen, daher hat **Abhängigkeiten installieren** hier nichts zu tun.
- Ein aktuelles Ergebnis des elektrischen Netzes des Projekts (Skill `network-sizing`); ein veraltetes wird abgelehnt.
- Der Industriekatalog mit den Kandidaten für Sicherungen und Schalter, als Artikel mit zitierten Werten und Bedingungen.
- Profilwerte, die Sie mit dem Agenten vereinbaren: die Art des Ausschaltvermögens, die Abschaltzeiten und die RCD-Empfindlichkeit. Der Agent wählt sie nicht selbst.

## Verwendung

- „Welcher dieser beiden Leistungsschalter kann Stromkreis Q3 beim Fehlerstrom an seinem Ursprung schützen?“ (Skill `protection-selection`)
- „Prüfen Sie die 16-A-gG-Sicherung gegen Iz des Kabels und die Abschaltzeit am Ende des Stromkreises.“
- „Bleibt die Durchlassenergie des Schalters für dieses Kabel unter k²S²?“
- „Ist der RCD-Typ laut Handbuch des Antriebs zulässig und liegt die Empfindlichkeit innerhalb der Profilgrenze?“
- „Ist der Schalter selektiv zur vorgelagerten Sicherung? Verwenden Sie die Herstellertabelle.“
- „Warum ist die Starterkoordination unbekannt, und welche Daten würden sie klären?“

Das Ergebnis wird mit seinen Eingaben unter `electrical-automation-results/<run-id>/` in der Workbench gespeichert. Ändert sich das Modell danach, wird das Ergebnis als veraltet markiert.

## Risiko und Freigaben

Das Werkzeug ist ein Schreibwerkzeug: Es speichert ein neues Ergebnis und fragt wie bei einem Dateischreibvorgang nach Ihrer Freigabe. In Sitzungen im Modus Nur lesen wird es nicht angeboten. Es ändert nie das elektrische Modell, konfiguriert kein Gerät und schreibt keine Relais- oder Schaltereinstellungen. Es gibt keine Aktionen der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Geprüft unter Windows x64 und WSL2; unter nativem Ubuntu x64 noch nicht ausgeführt.
- Selektivität, Back-up-Schutz und Koordination Typ 1 / Typ 2 werden nie aus der Überlappung von Kennlinien gelesen. Ohne Herstellertabelle für genau diese Produkte und Bedingungen wird das Paar nicht bewertet.
- Fehlende Daten bleiben unbekannt und bestehen nie: ein extrahierter, fehlender oder bedingungsfremder Katalogwert, eine Kennlinie ohne Band oder ein magnetischer Auslösestrom ohne Toleranz oder Auslösezeit lässt das Kriterium offen. Icu, Ics und Icn werden nie füreinander eingesetzt.
- Fixtures sind klein und zitiert; lizenzierte Herstellertabellen werden nicht mitgeliefert. Öffentliche Tabellen mit unbeeinflusstem Kurzschlussstrom, numerischen Sofortauslösezeiten, Zeit-Strom-Grenzen von Sicherungen und I²t gibt es oft nur zum Download oder gegen Lizenz, daher bleiben diese Kriterien offen, bis Sie sie bereitstellen.
- Ergebnisse sind vorläufige Ingenieurunterstützung: kein verifizierter Entwurf, keine Konformitätserklärung und keine Sicherheitsfunktion.
