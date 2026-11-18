# Freerouting-Autorouter (lokal)

Freerouting-Autorouter ermöglicht dem Agenten, einen KiCad-10-Platinenkandidaten auf diesem Computer mit Freerouting 2.5.0 automatisch zu routen. Er exportiert ein Specctra-DSN aus dem gespeicherten Kandidaten eines kicad-layout-Laufs, routet es offline mit begrenzter Anzahl Durchgänge und begrenztem Zeitbudget, wobei vorhandenes und gesperrtes Kupfer erhalten bleibt, und macht aus den neuen Leiterbahnen und Vias eine kicad-layout-Anfrage. kicad-layout wendet diese Anfrage dann auf den Kandidaten an und prüft ihn mit DRC. Freerouting läuft mit ausgeschalteten Online-Funktionen, und die Quellplatine ändert sich nur, wenn Sie das Übernehmen eines bestandenen Kandidaten freigeben.

## Voraussetzungen

- **Freerouting** 2.5.0 und eine Java-Laufzeit Eclipse Temurin 25: **Abhängigkeiten installieren** auf der Plugin-Seite lädt beide herunter und prüft ihre SHA-256. Es muss kein Java installiert sein.
- **freerouting-tool**: ein Skript im Plugin, das automatisch installiert wird.
- **KiCad 10**, das Sie selbst von https://www.kicad.org/download/ installieren (unter Ubuntu aus dem KiCad-10-PPA); verwenden Sie dann **Abhängigkeiten prüfen**. VERA installiert KiCad nie.
- Das Plugin **kicad-layout**, das den Kandidaten öffnet und die Routen anwendet. **Mit Abhängigkeiten installieren** fügt es hinzu.
- Eine Platine mit platzierten Bauteilen: Freerouting routet nur.
- Keine Konfigurationsparameter.

## Verwendung

- „Öffnen Sie einen Kandidaten von boards/sensor.kicad_pcb und routen Sie ihn automatisch.“ (Skill `freerouting`)
- „Routen Sie auf dem geöffneten Kandidaten nur die Netze VIN und GND.“
- „Routen Sie erneut mit einem Budget von 20 Minuten.“
- „Wenden Sie die Routen an, führen Sie DRC aus und zeigen Sie mir den Bericht und die Vorschauen.“
- „Übernehmen Sie den Kandidaten in die Quellplatine.“

Der Agent meldet, wie viele Verbindungen ungeroutet bleiben; DRC und die Anzahl offener Verbindungen stammen von KiCad, nicht von Freerouting. Freerouting ist kein Optimierer: Sein Ergebnis ist ein mögliches Routing, nicht das beste. Verbleibende Verbindungen lassen sich von Hand mit kicad-layout oder nach dem Verschieben von Bauteilen routen.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: `freerouting-tool route`, das auf einer Kopie des Kandidaten arbeitet und nur in den Laufordner schreibt, sowie KiCad-Version oder -Hilfe.
- Gesperrt: das direkte Ausführen von Java, des Freerouting-Archivs oder anderer `kicad-cli`-Befehle, weil `kicad-cli` Dateien im gelesenen Projektordner neu schreibt.

Das Anwenden der Routen auf den Kandidaten und das Übernehmen des Kandidaten in die Quellplatine sind Schritte von kicad-layout; das Schreiben der Quellplatine wartet auf Ihre Freigabe.

## Grenzen

- Windows x64 und Linux x64.
- Ein Projekt mit eigenen DRC-Regeln (`.kicad_dru`) wird abgelehnt, sofern Sie nicht akzeptieren, ohne sie zu routen; Freerouting kann sie nicht befolgen, und die DRC nach der Bearbeitung prüft sie trotzdem.
- Wenn das Zeitbudget abläuft, wird Freerouting gestoppt und keine Anfrage geschrieben.
- Freerouting läuft mit ausgeschalteter Versionsprüfung, Analytics, GUI und Servern; darüber hinaus sperrt VERA seinen Netzwerkzugriff nicht.
- Referenz: https://github.com/freerouting/freerouting
