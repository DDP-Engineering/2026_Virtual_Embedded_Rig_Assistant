# Bauteilsuche und Bauteilauswahl

Dieses Plugin hilft dem Agenten, elektronische Bauteile anhand von Belegen auszuwählen. Der Agent durchsucht die von Ihnen aktivierten Lieferantenkataloge (Mouser, DigiKey, TME, Farnell, Rutronik), bestätigt kritische Werte im Datenblatt des Herstellers mit Seite und Testbedingungen und vergleicht die Kandidaten zuerst mit harten Anforderungen und dann mit Präferenzen. Er schreibt einen Vergleich und eine vorgeschlagene Stückliste in einen neuen Ordner unter `electronics-results/`. Nichts wird bestellt, und weder ein Schaltplan noch die Stückliste eines Projekts wird geändert.

## Voraussetzungen

- **parts-compare**, ein Python-Skript im Plugin, das VERA mit **Abhängigkeiten installieren** selbst installiert. Es vergleicht offline.
- **Lieferanten-Zugangsdaten** (`supplier-keys`): die API-Zugangsdaten jedes Lieferanten, den Sie durchsuchen möchten, mit der Region, die die Suchen verwenden. Legen Sie sie im Abschnitt **Konfiguration** der Plugin-Seite fest: Mouser (API-Schlüssel), DigiKey (Client-ID und Client-Secret), TME (API-Token und Anwendungsgeheimnis), Farnell (API-Schlüssel und Shop) und Rutronik (API-Schlüssel von Ihrem Rutronik-Ansprechpartner). Die Zugangsdaten bleiben auf Ihrem Computer und werden dem Agenten nie angezeigt.
- **Webzugriff** in den **Einstellungen** eingeschaltet und das Plugin für die Workbench aktiviert. Die Suche wird nur angeboten, wenn beides eingeschaltet und mindestens ein Lieferant aktiviert ist.
- Keine Hardware und keine anderen Plugins.

## Verwendung

Der Agent verwendet den Skill `component-selection` für den Ablauf und `component-families` für die Prüfungen der einzelnen Bauteilfamilien (MOSFETs, Regler, Operationsverstärker, Widerstände, Kondensatoren, Dioden, Induktivitäten). Vor der Suche stimmt er die harten Anforderungen und Präferenzen mit Ihnen ab.

- „Suchen Sie einen N-Kanal-MOSFET im SOT-23-Gehäuse, der 5 A bei 24 V mit 3,3-V-Gate-Ansteuerung schaltet.“
- „Suchen Sie BSS806NE bei den aktivierten Lieferanten und zeigen Sie die Angebote.“
- „Vergleichen Sie diese drei LDOs für 3,3 V bei 300 mA aus 5 V, günstigste zuerst, für 500 Stück in EUR.“
- „Hat dieser MLCC bei 12 V DC-Bias noch 10 µF? Prüfen Sie das Datenblatt.“
- „Schlagen Sie einen pinkompatiblen Ersatz für den Regler auf der Platine vor.“

## Risiko und Freigaben

Das Vergleichen von Kandidaten ist als **Sicher** eingestuft: Es läuft offline auf Ihrem Computer, öffnet keine Netzwerkverbindung, überschreibt nie etwas und läuft ohne Rückfrage. Eine Lieferantensuche sendet nur den Suchtext oder die Teilenummer an die von Ihnen aktivierten Lieferanten.

## Grenzen

- Windows x64 und Linux x64.
- Jede Suche ist live, und VERA speichert kein Lieferantenergebnis. Angebote sind eine Momentaufnahme ohne Steuern und Versand.
- Lieferantenparameter gelten als unbestätigt, bis sie im Datenblatt geprüft sind. Werte aus Kurven oder gescannten Seiten müssen Sie selbst bestätigen.
- TME-Daten: powered by TME.eu Data; keine Gewähr für die Richtigkeit der Daten.
