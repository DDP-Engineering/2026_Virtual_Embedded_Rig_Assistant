# Einstellungen

**Einstellungen** unten in der Seitenleiste öffnet die Anwendungseinstellungen. Sie gelten für alle Workbenches; die Einstellungen eines einzelnen Workbenchs finden Sie unter **Workbench bearbeiten** (siehe [Workbenches](workbenches.md)). Änderungen werden sofort gespeichert, außer auf Seiten mit einer eigenen Schaltfläche **Speichern**. **Zurück zu Workbenches** führt Sie zurück zu Ihrer Arbeit.

| Seite | Was sie festlegt |
|---|---|
| **Anbieter** | Zugang zu KI-Modellen; siehe [Anbieter und Modelle](providers.md) |
| **Webzugriff** | Websuche und Lesen von Webseiten für den Agenten |
| **Darstellung und Sprache** | Sprache, Design und Textgrößen |
| **Befehle** | Die Shell für Agentenbefehle und neue Terminals |
| **Benachrichtigungen** | Noch nicht verfügbar |
| **Tastenkombinationen** | Ihre eigenen Tastenkombinationen |
| **Aktualisierungen** | Wie VERA sich selbst aktualisiert |
| **Daten & Datenschutz** | Maskierungsstandards für vier Bereiche |
| **Über** | Version, Laufzeit, Lizenz und Komponenten von Drittanbietern |

## Daten & Datenschutz

Wählen Sie, ob gespeicherte Geheimnisse in **Anzeige**, **Programmläufe**, **Agent und Modell** und **Artefakte und Exporte** durch `[REDACTED]` ersetzt werden. Anzeige und Programmläufe sind standardmäßig aus; Agent und Modell sowie Artefakte und Exporte sind ein. Nur VERA bekannte gespeicherte Geheimnisse werden maskiert; andere vertrauliche Texte werden nicht automatisch erkannt. Anbieterfehler, Verbindungstests und Diagnoseprotokolle bleiben immer geschützt.

**Speichern** und **Abbrechen** stehen oben rechts. Schalter ändern bis zum Speichern nur den Entwurf. Beim Ausschalten von **Agent und Modell** erscheint eine Bestätigung: gespeicherte Geheimnisse aus Dateien oder Werkzeugausgaben können den Modellanbieter erreichen. Abbrechen oder Escape behält die bisherige Auswahl. Die anderen Bereiche fragen nicht nach.

Unter **Workbench bearbeiten → Daten & Datenschutz** hat jeder Bereich **Standard**, **Ein** oder **Aus**. Standard zeigt den aktuellen App-Wert und folgt späteren Änderungen; ausdrückliche Werte gehören zum Workbench und werden mit seiner Konfiguration kopiert. Auch Standard fragt nach, wenn dadurch Agent und Modell ausgeschaltet wird. Neue Workbenches übernehmen ohne eigene Auswahl die App-Werte. Schreibgeschützte Workbenches können Änderungen nicht speichern.

Ausschalten stellt bereits als `[REDACTED]` gespeicherte Inhalte einschließlich Sitzungsverlauf und Artefakten nicht wieder her. Lesen oder erstellen Sie diese aus der Originalquelle neu. Einschalten löscht keinen zuvor unmaskiert gespeicherten Verlauf.

## Darstellung und Sprache

- **Sprache der Oberfläche**: **System**, **English**, **Română**, **Deutsch** oder **Français**. **System** verwendet die Sprache Ihres Betriebssystems, wenn es eine dieser vier ist, sonst Englisch. Datums- und Zahlenformate folgen der Sprache der Oberfläche, und auch die Hilfe wird in dieser Sprache angezeigt.
- **Design**: **Hell**, **Dunkel** oder **System**.
- Drei getrennte Textgrößen, jeweils von **Sehr klein** bis **Maximal**, mit Vorschau:
  - **Textgröße der Oberfläche**: Menüs, Beschriftungen, Schaltflächen und das Layout darum herum.
  - **Textgröße der Unterhaltung**: die Nachrichten einer Sitzung.
  - **Textgröße für Code und Ausgaben**: Codeblöcke, Werkzeugausgaben und Dateiinhalte.
- **Standardtextgrößen wiederherstellen** setzt alle drei auf ihre Standardwerte zurück.

## Tastenkombinationen

Die Seite listet jeden Befehl mit seiner Tastenkombination auf. Sie können Kombinationen hinzufügen, ändern oder entfernen; **Standard wiederherstellen** und **Alle Standards wiederherstellen** machen Ihre Änderungen rückgängig. Kombinationen verwenden Ctrl, optional mit Alt oder Shift, und einen Buchstaben, eine Ziffer, ein Komma oder einen Schrägstrich; VERA lehnt reservierte oder bereits belegte Kombinationen ab. Die Standardliste finden Sie unter [Tastenkombinationen](shortcuts.md).

## Aktualisierungen

- **Aktualisierungsmodus**: **Aus**, **Benachrichtigen** oder **Automatisch herunterladen**. Mit **Benachrichtigen** informiert VERA Sie über eine neue Version und lädt sie erst herunter, wenn Sie **Aktualisierung herunterladen** wählen.
- **Kanal**: **Stabil** oder **Beta (einschließlich stabil)**.
- **Jetzt prüfen** prüft sofort, auch wenn der Modus **Aus** ist. Andernfalls prüft VERA beim Start und alle sechs Stunden.

Wenn ein Update heruntergeladen wurde, wählen Sie **Zum Aktualisieren neu starten**. VERA wartet, bis alle laufenden Durchläufe und ausstehenden Freigaben abgeschlossen sind. Jedes Update wird vor der Installation überprüft, und VERA installiert nie eine ältere Version.

Die portable Version kündigt Updates nur an: Öffnen Sie den Download-Link und ersetzen Sie dann den Anwendungsordner. Eine Linux-Installation per `.deb` wird über Ihren Paketmanager aktualisiert.

**Aus** stoppt auch die tägliche Prüfung des Plugin-Katalogs; **Nach Updates suchen** auf der Seite **Plugins** funktioniert weiterhin.

## Webzugriff

Der Webzugriff erlaubt dem Agenten, das öffentliche Web zu durchsuchen, öffentliche Seiten zu lesen und öffentliche Dateien herunterzuladen. Er ist standardmäßig aktiviert, mit Exa im anonymen Modus.

1. Aktivieren oder deaktivieren Sie **Webzugriff aktivieren**.
2. Wählen Sie den **Suchanbieter**: Exa, Tavily oder Brave.
3. Wählen Sie den **Zugriffsmodus**: **Anonym — kein Konto erforderlich** oder **Meinen API-Schlüssel verwenden**, und geben Sie dann den Schlüssel ein. Brave benötigt immer einen Schlüssel und kann nur suchen, keine Seiten lesen.
4. Wählen Sie **Speichern** und dann **Verbindung testen**.

Nur der Suchtext und die Adressen, die der Agent anfordert, verlassen Ihren Computer; VERA lädt für eine Suche keine Projektdateien hoch. Die anonyme Nutzung unterliegt den Limits des Anbieters. Webergebnisse werden als nicht vertrauenswürdige Inhalte behandelt, und der Agent zitiert sie mit ihren öffentlichen Links; beim Öffnen eines Links wird nachgefragt, bevor Ihr Browser ihn öffnet.

Das Ausschalten des Webzugriffs stoppt auch laufende Suchen und Downloads. Einzelne Workbenches können die Webwerkzeuge unter **Workbench bearbeiten** → **Werkzeuge** deaktivieren.

## Über

**Über** zeigt die Anwendungsversion, Plattform, Architektur, ob VERA als portable Version läuft, das Gebietsschema des Systems, die Laufzeitversionen, die Lizenz und die Liste der Drittanbieterkomponenten mit ihren Lizenzen.

## Shell-Befehle

Unter Einstellungen → Befehle Automatisch, PowerShell 7, Windows PowerShell, Cmd, Bash oder Benutzerdefiniert wählen und speichern. Installierte Varianten werden in Suchpfaden und Standardordnern erkannt; fehlende Varianten sind deaktiviert. Benutzerdefiniert akzeptiert einen Programmnamen oder absoluten Pfad. Automatisch bevorzugt unter Windows PowerShell 7, Windows PowerShell und dann Cmd; Linux bevorzugt Bash und dann sh. PowerShell nutzt nicht interaktive UTF-8-Befehle ohne Profil. Bash verwendet `-lc`; Anmeldeprofile können die Umgebung ändern. Unter Windows ist Bash eine native Shell wie Git Bash; der alte WSL-Launcher wird nicht gewählt. Cmd nutzt `/d /s /c` und eine Befehlszeile mit `&` oder `&&`; interne Befehle geben in der Windows-Codepage aus. Für UTF-8-Ausgabe PowerShell oder Bash verwenden. Die Wahl gilt für künftige Agentenbefehle und neue Terminals; vorhandene Terminals behalten ihre Shell. Eine ausdrücklich gewählte, fehlende Shell meldet einen Fehler.
