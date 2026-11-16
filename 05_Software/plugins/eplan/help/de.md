# EPLAN-Austausch

Mit dem EPLAN-Austausch vergleicht der Agent Ihr EPLAN-Electric-P8-2025-Projekt mit der Elektrodokumentation in VERA und gibt freigegebene Artikeldaten an EPLAN zurück. Er liest die Geräteliste sowie die Klemmen- und Verbindungstabellen, die EPLAN exportiert, zeigt, was von den Dokumentationslisten abweicht, erstellt eine Gerätelisten-Datei zum Import und lässt sie in eine Kopie Ihres Projekts importieren, nie in das Original. Eine Prüfung zeigt dann, ob jeder Wert angekommen ist und sich sonst nichts geändert hat.

**Noch nicht mit einer echten EPLAN-Installation geprüft.** Es folgt der öffentlichen EPLAN-API-Dokumentation; probieren Sie es zuerst an einer Kopie eines Testprojekts.

## Was es braucht

- Ihr eigenes lizenziertes EPLAN Electric P8 2025 unter Windows, im Standardordner installiert (Program Files\EPLAN\Platform\2025...). VERA installiert und liefert nichts von EPLAN mit.
- Das Programm **eplan-tool** dieses Plugins (ein kleines Python-Skript): **Install dependencies** auf der Plugin-Seite.
- Eine Profildatei in `electrical-automation-eplan/`, die Ihre Projektdatei (.elk, Pfad ohne Leerzeichen) und die Spaltenüberschriften Ihrer EPLAN-Exporte nennt. Für Klemmen und Verbindungen ein EPLAN-Exportschema („externe Bearbeitung“), das durch Semikolon getrennten Text mit Kopfzeile schreibt.
- Einen aktuellen Lauf der Elektrodokumentation (Plugin Elektrodokumentation) zum Vergleich.

## So nutzen Sie es

- „Schreibe ein EPLAN-Profil für C:\EPLAN\Projects\PlantM.elk mit diesen Spaltenüberschriften.“ (Skill `eplan-exchange`)
- „Exportiere die Geräteliste sowie die Klemmen- und Verbindungstabellen aus EPLAN.“
- „Vergleiche den EPLAN-Export mit dem letzten Dokumentationslauf.“
- „Bereite eine Importdatei vor, die die Artikelnummern in EPLAN korrigiert.“
- „Importiere sie in eine Kopie des Projekts und prüfe, ob alles angekommen ist.“

## Risiko und Freigaben

`eplan` liest nur. `eplan_change` und `eplan_check` sind Schreibwerkzeuge: Sie fragen wie ein Dateischreibvorgang nach Ihrer Freigabe und werden in schreibgeschützten Sitzungen nicht angeboten. **eplan-tool export** ist eine Geräte-Leseaktion: Sie startet EPLAN mit Ihrem schreibgeschützt geöffneten Projekt. **eplan-tool import** ist eine Geräte-Schreibaktion: Sie erstellt eine neue Kopie Ihres Projekts und importiert die freigegebene Datei in diese Kopie; Ihr Originalprojekt bleibt unverändert. Jeder EPLAN-Befehl nennt sein Projekt; nichts wird an ein von Ihnen geöffnetes EPLAN angehängt, und kein Skript aus einem Projekt wird ausgeführt. Ein fehlgeschlagener, abgelehnter oder gestoppter Import wird nie als übernommen gemeldet.

## Grenzen

- Nur Windows x64. Noch nicht mit einem echten EPLAN ausgeführt: Dateiaufbau, Exit-Codes, Lizenzmeldungen und das Verhalten bei einem anderswo geöffneten Projekt sind unbestätigt.
- Importiert wird nur die Geräteliste (Artikelnummern und die Spalte VERA-ID). Verbindungen, Klemmen und Makros werden verglichen, aber nie importiert; Makros werden gar nicht behandelt.
- An EPLAN übergebene Pfade dürfen keine Leerzeichen oder Anführungszeichen enthalten.
- Ergebnisse sind vorläufige technische Unterstützung: kein geprüfter Entwurf und keine Konformitätsaussage.
