# Erste Schritte

Diese Seite führt Sie vom ersten Start bis zu einer ersten Antwort mit Quellenverweisen. Das dauert einige Minuten, zuzüglich der Zeit, die VERA zum Indizieren Ihrer Dokumente benötigt.

## Was Sie benötigen

- VERA, installiert unter Windows x64 oder Linux x64. Ohne Netzwerk siehe [Offline-Installation](offline-install.md).
- Zugang zu einem KI-Modell: einen OpenAI-API-Schlüssel, ein ChatGPT-Abonnement oder einen lokalen Modellserver wie LM Studio oder Ollama.
- Einen Projektordner auf einem lokalen Laufwerk, idealerweise mit seiner Dokumentation (Datenblätter, Referenzhandbücher, Schaltpläne als PDF, Notizen in Markdown).

## Erster Start

VERA öffnet sich auf **Start**, wo Ihre **Workbenches** aufgelistet sind und **Workbench erstellen** angeboten wird. Die Seitenleiste enthält **Neuer Workbench**, **Workbench öffnen** und **Plugins**; **Einstellungen** befindet sich unten in der Seitenleiste.

Um zuerst die Sprache der Oberfläche zu ändern, öffnen Sie **Einstellungen** → **Darstellung und Sprache** und wählen Sie unter **Sprache der Oberfläche** eine Sprache.

## Schritt 1: einen Anbieter verbinden

1. Öffnen Sie **Einstellungen** → **Anbieter**.
2. Wählen Sie eine dieser Möglichkeiten:
   - ChatGPT-Abonnement: Wählen Sie **Anbieter hinzufügen**, als **Anbieter** das **ChatGPT-Abonnement** und dann **Mit ChatGPT anmelden** und schließen Sie die Anmeldung in Ihrem Browser ab.
   - API-Schlüssel oder lokaler Server: Wählen Sie **Anbieter hinzufügen**, wählen Sie den **Anbieter** (**OpenAI-API**, LM Studio, Ollama oder **Anderer kompatibler Anbieter**), füllen Sie die Felder aus und wählen Sie **Speichern**.
3. Wählen Sie **Testen** neben der Verbindung. Alle vier Schritte (**Erreichbarkeit**, **Authentifizierung und Modell**, **Werkzeugaufrufe**, **Streaming**) sollten **Bestanden** anzeigen.

Details finden Sie unter [Anbieter und Modelle](providers.md).

## Schritt 2: einen Workbench erstellen

1. Wählen Sie **Neuer Workbench**.
2. Wählen Sie **Ordner auswählen** und wählen Sie Ihren Projektordner. Der Name wird aus dem Ordnernamen übernommen.
3. Prüfen Sie unter **Dokumente & RAG** die Dokumentationsordner, die VERA gefunden hat, oder verwenden Sie **Ordner hinzufügen…**.
4. Wählen Sie **Workbench erstellen**.

VERA öffnet eine Sitzung mit Fokus auf dem Nachrichtenfeld und beginnt im Hintergrund mit der Indizierung. Sie können bereits chatten; die Symbolleiste in **Dateien** zeigt die Aktivität und die Workbench-Übersicht den detaillierten Fortschritt. Siehe [Workbenches](workbenches.md) und [Dokumente und Suche](documents-and-search.md).

## Schritt 3: eine erste Frage stellen

1. Verwenden Sie die beim Erstellen des Workbenchs geöffnete Sitzung. Wählen Sie **Neue Sitzung** für eine weitere Unterhaltung.
2. Wählen Sie in den Steuerelementen des Nachrichtenfelds ein **Modell**. Lassen Sie den Berechtigungsmodus vorerst auf **Nachfragen**.
3. Geben Sie eine Frage zu Ihrem Projekt ein, zum Beispiel „Wie hoch ist der maximale SPI-Takt des Sensors, und welche Pins verwendet er?“, und drücken Sie Enter.

Der Agent durchsucht Ihre Dokumente, liest die relevanten Seiten und antwortet. Quellen-Chips in der Antwort nennen die Quelle; wählen Sie einen aus, um das Dokument an der zitierten Seite, Überschrift oder Zeile zu öffnen.

Möchte der Agent eine Datei ändern oder ein Programm ausführen, fragt er zuerst mit einer Freigabekarte nach. Siehe [Berechtigungen](permissions.md).

## Nächste Schritte

- Lassen Sie den Agenten mit den Werkzeugen an Ihrem Laborplatz arbeiten: [Plugins](plugins.md).
- Erfahren Sie, wie Sitzungen, das Steuern laufender Durchläufe und der Export funktionieren: [Chat und Sitzungen](chat-and-sessions.md).
- Passen Sie Textgrößen, Design und Aktualisierungen an: [Einstellungen](settings.md).
