# VERA-Hilfe

VERA, der Virtual Embedded Rig Assistant, ist ein Desktop-Workbench für Embedded-Ingenieure. Sie öffnen einen Projektordner als Workbench, und VERA indiziert dessen Datenblätter, Handbücher und Notizen auf Ihrem Computer. Ein KI-Agent beantwortet Ihre Fragen zum Projekt und nennt die Seiten, die er verwendet hat; ein Quellenverweis öffnet das Dokument an genau dieser Stelle. Über Plugins kann der Agent auch die Werkzeuge an Ihrem Laborplatz ausführen, etwa Flash-Tools, serielle Monitore oder Debugger, immer in dem Berechtigungsmodus, den Sie wählen.

## Hilfe öffnen

- Wählen Sie **?** in der oberen Leiste, neben **Rechten Bereich ein- oder ausblenden**.
- Drücken Sie F1, um die Hilfeseite des Bildschirms zu öffnen, auf dem Sie sich befinden.

Die Hilfe zeigt die Liste der Seiten und die ausgewählte Seite. Links zwischen Seiten öffnen die verlinkte Seite innerhalb der Hilfe.

Die Hilfe wird mit VERA installiert und funktioniert daher ohne Netzwerk. Sie wird in der Sprache der Oberfläche angezeigt. Ist eine Seite in dieser Sprache nicht vorhanden, wird stattdessen die englische Seite angezeigt.

## Den Agenten fragen

Der Agent kann diese Hilfeseiten ebenfalls lesen. Fragen Sie in einer beliebigen Sitzung zum Beispiel „Wie aktiviere ich ein Plugin in VERA?“ oder „Wie exportiere ich eine Sitzung in VERA?“, und er sucht die Antwort in der Hilfe.

## Plugin-Hilfe

Jedes installierte Plugin hat eine eigene Hilfeseite: was das Plugin tut, was es benötigt und wie Sie den Agenten bitten, es zu verwenden. Sie finden sie in der Hilfe in der Seitenliste und auf der Karte des Plugins auf der Seite **Plugins**.

## Seiten

| Seite | Inhalt |
|---|---|
| [Erste Schritte](getting-started.md) | Erster Start, ein Anbieter, ein erster Workbench, eine erste Frage |
| [Workbenches](workbenches.md) | Workbenches erstellen, öffnen, anheften und bearbeiten; schreibgeschützte Workbenches; der Ordner `.vera/` |
| [Chat und Sitzungen](chat-and-sessions.md) | Sitzungen, einen laufenden Durchlauf steuern, Archivieren, Export, Detailgrade, Reasoning |
| [Berechtigungen](permissions.md) | Nur lesen, Nachfragen, Auto-Edit und Bypass; Freigaben, Änderungen und Risikostufen |
| [Dokumente und Suche](documents-and-search.md) | Indizierung, Suche, Quellenverweise, der Dokumentbetrachter, Downloads |
| [Anbieter und Modelle](providers.md) | OpenAI, ChatGPT-Abonnement, LM Studio, Ollama und andere Endpunkte |
| [Plugins](plugins.md) | Katalog, Installation, Prüfung und Vertrauen, Abhängigkeiten, Konfiguration, Pakete |
| [Einstellungen](settings.md) | Darstellung, Sprache, Aktualisierungen, Webzugriff, Tastenkombinationen |
| [Tastenkombinationen](shortcuts.md) | Alle Tastenkombinationen von VERA |
| [Offline-Installation](offline-install.md) | VERA und Plugins auf einem Computer ohne Netzwerk installieren |
| [Fehlerbehebung](troubleshooting.md) | Häufige Probleme, Protokolle und wo VERA seine Daten ablegt |

## Über VERA

Version, Laufzeitversionen, Lizenz und Komponenten von Drittanbietern finden Sie unter **Einstellungen** → **Über**.
