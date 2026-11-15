# Workbenches

Eine Workbench ist ein Projektordner, in dem VERA arbeitet: Quellcode, Datenblätter, Schaltpläne, Protokolle und Notizen. VERA legt seine eigenen Daten für den Ordner in einem Unterordner `.vera/` ab und verschiebt oder konvertiert Ihre übrigen Dateien nicht. Jede Workbench hat eigene Sitzungen, einen eigenen Dokumentindex, eigene Anweisungen und eigene aktivierte Plugins.

## Eine Workbench erstellen

1. Wählen Sie **Neue Workbench** in der Seitenleiste.
2. Wählen Sie unter **Allgemein** die Option **Ordner auswählen** und wählen Sie den Ordner. **Name des Arbeitsbereichs** wird aus dem Ordnernamen übernommen; Sie können ihn bei Bedarf ändern.
3. Prüfen Sie unter **Dokumente & RAG** die Dokumentationsordner, die VERA gefunden hat, oder wählen Sie **Ordner hinzufügen…**. Die Vorschauzeile zeigt, wie viele Dokumente indiziert werden. Unter **Erweitert: Einschluss- und Ausschlussmuster** können Sie die Muster direkt bearbeiten.
4. Passen Sie bei Bedarf die anderen Abschnitte an (siehe Tabelle unten).
5. Wählen Sie oben rechts **Arbeitsbereich erstellen**.

Ist der Ordner bereits eine Workbench, bietet VERA stattdessen **Diese Workbench öffnen** an. Eine vorhandene `.vera/WORKBENCH.md` bleibt unverändert.

Verwenden Sie einen Ordner auf einem lokalen Laufwerk. Netzwerkfreigaben werden nicht unterstützt.

## Geöffnete, zuletzt verwendete und angeheftete Workbenches

- **Workbench öffnen** öffnet einen Ordner, der bereits `.vera/workbench.yaml` enthält.
- Die Seitenleiste listet Ihre zuletzt verwendeten Workbenches auf. Angeheftete Workbenches bleiben oben.
- Jede Zeile hat ein Menü **Workbench-Aktionen**: **Anheften** oder **Loslösen**, **Nach oben verschieben**, **Nach unten verschieben**, **Workbench bearbeiten**, **Im Explorer öffnen**, **Arbeitsbereich schließen** und **Aus Liste entfernen**.
- **Aus Liste entfernen** entfernt nur den Eintrag; es wird keine Datei gelöscht.
- Wurde ein Ordner verschoben oder gelöscht, zeigt sein Eintrag **Ordner fehlt**. Entfernen Sie ihn aus der Liste oder öffnen Sie den Ordner an seinem neuen Ort.
- **Sitzungen anzeigen** und **Sitzungen ausblenden** klappen die Sitzungen einer Workbench in der Seitenleiste auf oder zu.

Wählen Sie den Namen einer Workbench, um ihre **Workbench-Übersicht** zu sehen: das Konversationsmodell, den Berechtigungsmodus, die indizierten und ausgeschlossenen Quellen und die Sitzungen.

## Eine Workbench bearbeiten

Wählen Sie **Workbench bearbeiten** in der Übersicht oder im Zeilenmenü. Ändern Sie die Abschnitte und wählen Sie dann oben rechts **Speichern**; **Abbrechen** verwirft Ihre Änderungen. Wenn Sie die Seite mit ungespeicherten Änderungen verlassen, fragt VERA zuerst nach.

| Abschnitt | Was er festlegt |
|---|---|
| **Allgemein** | Name und Beschreibung |
| **Dokumente & RAG** | Welche Ordner und Dateien indiziert werden |
| **Agent und Chat** | Standardmodell, Standard-Berechtigungsmodus, **Detailgrad** |
| **Anweisungen** | Der Text von `.vera/WORKBENCH.md`, den der Agent in jeder Sitzung liest |
| **Werkzeuge** | Welche integrierten Werkzeuge der Agent verwenden darf |
| **Skills** | Skills der Workbench und des Benutzers: aktivieren, erstellen und bearbeiten |
| **Indizierung** | Embedding-Einstellungen und die Standardwerte der Dokumentsuche des Agenten |
| **Plugins** | Welche installierten Plugins diese Workbench aktiviert |

Halten Sie die Anweisungen kurz und sachlich: das Board, der Mikrocontroller, die Toolchain, Konventionen. Nur die ersten 16 KB werden an den Agenten übergeben; VERA warnt, wenn der Text länger ist.

## Schreibgeschützte Workbenches

Eine Workbench wird schreibgeschützt geöffnet, wenn ein anderer VERA-Prozess sie bereits geöffnet hat, zum Beispiel eine zweite VERA-Installation. Sie können Sitzungen lesen, Dateien durchsuchen und öffnen sowie Sitzungen exportieren, aber keine Nachrichten senden und keine Einstellungen speichern. Schließen Sie die andere Instanz und öffnen Sie die Workbench erneut, um darin zu arbeiten.

## Der Ordner .vera

| Element | Inhalt |
|---|---|
| `workbench.yaml` | Die Konfiguration der Workbench; bearbeiten Sie sie über **Workbench bearbeiten** |
| `WORKBENCH.md` | Die Anweisungen für den Agenten |
| `.veraignore` | Optionale Regeln für Dateien, die der Agent und der Index nicht sehen dürfen |
| `skills/` | Skills dieser Workbench |
| `plugins/` | Plugin-Pakete, die mit dem Projekt geteilt werden |
| `vera.db` | Sitzungen, Freigaben, Änderungen und der Dokumentindex |
| `artifacts/`, `downloads/`, `runs/` | Sitzungsartefakte, heruntergeladene Dateien, Protokolle von Programmläufen |

`.vera/` enthält eine `.gitignore`, die nur die Konfiguration, die Anweisungen, `.veraignore` und die Skills unter Versionskontrolle hält. Der Agent kann `workbench.yaml` und `.vera/plugins` in keinem Berechtigungsmodus ändern.

`.veraignore` verwendet dieselbe Mustersyntax wie `.gitignore`. Die Ordner `.vera`, `.git` und `node_modules` werden immer ignoriert.
