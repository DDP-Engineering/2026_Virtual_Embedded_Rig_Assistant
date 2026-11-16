# Elektrodokumentation

Die Elektrodokumentation lässt den Agenten die Listen Ihres Projekts erzeugen - Material, Drähte (Verbindungen), Kabel, Klemmen, Beschriftungen und E/A, mit Inhaltsverzeichnis - aus dem, was VERA bereits kennt: dem Elektromodell, einer gespeicherten Schrankprüfung und den QElectroTech-Plänen, die Sie nennen. Jede Zeile zeigt die Datei, aus der sie stammt, mit deren Hash, und die Listen werden gegeneinander geprüft.

## Was es braucht

- **Kein Programm.** Der Agent nutzt die eingebauten VERA-Werkzeuge `electrical_documentation`, `electrical_documentation_check` und `electrical_documentation_export`, die nur angeboten werden, solange dieses Plugin aktiviert ist. Es gibt nichts zu installieren oder herunterzuladen, daher hat **Abhängigkeiten installieren** hier nichts zu tun.
- Eine gespeicherte Schrankprüfung (Plugin Panel engineering) und die QElectroTech-Pläne der Motoren (Plugin QElectroTech schematics).
- Für SPS-Tags optional eine Tag-Datei, die Sie aus Ihrem SPS-Werkzeug exportieren: eine CSV-Datei mit den Spalten `name` und `address` (optional `dataType`, `comment`). Es wird kein SPS-Projekt geöffnet.
- Für die Revision ein Dokumentobjekt im Elektromodell mit dem Attribut `revision` (optional `date`, `author`).

## So verwenden Sie es

- „Erstelle die Dokumentation für den Schrank MCP1 aus der letzten Schrankprüfung und den Plänen von M1 und M2, mit den Tags aus plc/tags.csv." (Skill `electrical-documentation`)
- „Zeig mir die Drahtliste."
- „Welche E/A haben keinen Tag oder eine andere Adresse in der Tag-Datei?"
- „Was hat sich seit dem letzten Dokumentationslauf geändert?"
- „Exportiere die Klemmenliste als CSV und alles als PDF."

Das Ergebnis wird in `electrical-automation-results/<run-id>/` gespeichert; Exporte werden als neue Dateien daneben geschrieben.

## Was geprüft wird

- Drahtnummerierung: eine Nummer je Potenzial, keine Nummer auf zwei Potenzialen, jeder Leiter nummeriert und an beiden Enden angeschlossen, nie zwei Leiter zwischen denselben Anschlüssen.
- In einem Plan gezeichnete Kennzeichen, die weder im Schrank noch im Modell stehen, und Starterverbindungen, die der Plan nicht zeichnet.
- Kabel ohne Ende im Schrank oder an der Last und Klemmen jenseits der Größe ihrer Leiste.
- Für jeden E/A: das Gerät, die physische Klemme, die Adresse auf einem SPS-Modul des Schranks und genau ein Tag, sowie dieselbe Adresse in der Tag-Datei.
- Die Revision: unter derselben Revision geänderter Inhalt oder ein Planblatt mit anderer Revision.

## Risiko und Freigaben

`electrical_documentation` liest nur. `electrical_documentation_check` und `electrical_documentation_export` sind Schreibwerkzeuge: Sie fragen wie ein Dateischreibvorgang nach Ihrer Freigabe und werden in Read-only-Sitzungen nicht angeboten. Sie schreiben nur ihre neue Ergebnis- oder Exportdatei; Modell, Schrankdatei, Pläne und Tag-Datei werden nie geändert - Unterschiede werden gemeldet, damit Sie sie beheben. Nichts wird gedruckt, bestellt oder gesendet.

## Grenzen

- Die Listen enthalten nur, was Modell, Schrankprüfung, genannte Pläne und Tag-Datei enthalten; Revision und Autor werden nie erfunden.
- Exporte sind auf Englisch. PDF-Text nutzt die Standardschrift Courier: Zeichen außerhalb westeuropäischer Schrift erscheinen als `?`.
- Geprüft unter Windows x64 und mit von VERA geschriebenen Projekten im QElectroTech-Format; noch nicht unter nativem Ubuntu x64 oder mit nummerierten, von QElectroTech gespeicherten Projekten.
