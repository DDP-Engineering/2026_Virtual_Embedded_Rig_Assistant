# Einstellungen

**Einstellungen** unten in der Seitenleiste öffnet die Anwendungseinstellungen. Sie gelten für alle Workbenches; die Einstellungen einer einzelnen Workbench finden Sie unter **Workbench bearbeiten** (siehe [Workbenches](workbenches.md)). Änderungen werden sofort gespeichert, außer auf Seiten mit einer eigenen Schaltfläche **Speichern**. **Zurück zu Workbenches** führt Sie zurück zu Ihrer Arbeit.

| Seite | Was sie festlegt |
|---|---|
| **Anbieter** | Zugang zu KI-Modellen; siehe [Anbieter und Modelle](providers.md) |
| **Webzugriff** | Websuche und Lesen von Webseiten für den Agenten |
| **Darstellung und Sprache** | Sprache, Design und Textgrößen |
| **Benachrichtigungen** | Noch nicht verfügbar |
| **Tastenkombinationen** | Ihre eigenen Tastenkombinationen |
| **Aktualisierungen** | Wie VERA sich selbst aktualisiert |
| **Daten & Datenschutz** | Noch nicht verfügbar |
| **Über** | Version, Laufzeit, Lizenz und Komponenten von Drittanbietern |

## Darstellung und Sprache

- **Sprache der Oberfläche**: **System**, **English**, **Română**, **Deutsch** oder **Français**. **System** verwendet die Sprache Ihres Betriebssystems, wenn es eine dieser vier ist, sonst Englisch. Datums- und Zahlenformate folgen der Sprache der Oberfläche, und auch die Hilfe wird in dieser Sprache angezeigt.
- **Design**: **Hell**, **Dunkel** oder **System**.
- Drei getrennte Textgrößen, jeweils von **Sehr klein** bis **Maximal**, mit Vorschau:
  - **Textgröße der Oberfläche**: Menüs, Beschriftungen, Schaltflächen und das Layout darum herum.
  - **Textgröße der Unterhaltung**: die Nachrichten einer Sitzung.
  - **Textgröße für Code und Ausgaben**: Codeblöcke, Werkzeugausgaben und Dateiinhalte.
- **Standardtextgrößen wiederherstellen** setzt alle drei auf ihre Standardwerte zurück.

## Tastenkombinationen

Die Seite listet jeden Befehl mit seiner Tastenkombination auf. Sie können Kombinationen hinzufügen, ändern oder entfernen; **Standard wiederherstellen** und **Alle Standards wiederherstellen** machen Ihre Änderungen rückgängig. Kombinationen verwenden Ctrl, optional mit Alt oder Shift, und einen Buchstaben, eine Ziffer, ein Komma oder einen Schrägstrich; VERA lehnt reservierte oder bereits belegte Kombinationen ab. Die Standardliste finden Sie unter [Tastenkürzel](shortcuts.md).

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

Unter Einstellungen → Befehle einen installierten Shell-Namen oder absoluten Pfad eingeben und Speichern wählen. Ein leeres Feld wählt automatisch. Windows nutzt PowerShell 7, sonst Windows PowerShell, ohne Profil, nicht interaktiv und mit UTF-8-Ausgabe. Linux nutzt `bash -lc`, sonst `sh -c`; Anmeldeprofile können die Umgebung ändern. Eine ausdrücklich gewählte, fehlende Shell meldet einen Fehler. Windows akzeptiert `pwsh.exe` oder `powershell.exe`; Linux nutzt `-lc` für bash und `-c` für andere Shells.
