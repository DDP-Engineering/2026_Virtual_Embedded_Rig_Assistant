# Workbenches

Ein Workbench ist ein Projektordner, in dem VERA arbeitet: Quellcode, Datenblätter, Schaltpläne, Protokolle und Notizen. VERA legt seine eigenen Daten für den Ordner in einem Unterordner `.vera/` ab und verschiebt oder konvertiert Ihre übrigen Dateien nicht. Jeder Workbench hat eigene Sitzungen, einen eigenen Dokumentindex, eigene Anweisungen und eigene aktivierte Plugins.

## Einen Workbench erstellen

1. Wählen Sie **Neuer Workbench** in der Seitenleiste.
2. Wählen Sie unter **Allgemein** die Option **Ordner auswählen** und wählen Sie den Ordner. **Name des Workbenchs** wird aus dem Ordnernamen übernommen; Sie können ihn bei Bedarf ändern.
3. Prüfen Sie unter **Dokumente & RAG** die Dokumentationsordner, die VERA gefunden hat, oder wählen Sie **Ordner hinzufügen…**. Die Vorschauzeile zeigt, wie viele Dokumente indiziert werden. Unter **Erweitert: Einschluss- und Ausschlussmuster** können Sie die Muster direkt bearbeiten.
4. Passen Sie bei Bedarf die anderen Abschnitte an (siehe Tabelle unten).
5. Wählen Sie oben rechts **Workbench erstellen**.

Ist der Ordner bereits ein Workbench, bietet VERA stattdessen **Diesen Workbench öffnen** an. Eine vorhandene `.vera/WORKBENCH.md` bleibt unverändert.

Verwenden Sie einen Ordner auf einem lokalen Laufwerk. Netzwerkfreigaben werden nicht unterstützt.

## Geöffnete, zuletzt verwendete und angeheftete Workbenches

- **Workbench öffnen** öffnet einen Ordner, der bereits `.vera/workbench.yaml` enthält.
- Die Seitenleiste listet Ihre zuletzt verwendeten Workbenches auf. Angeheftete Workbenches bleiben oben.
- Jede Zeile hat ein Menü **Workbench-Aktionen**: **Anheften** oder **Loslösen**, **Nach oben verschieben**, **Nach unten verschieben**, **Workbench bearbeiten**, **Im Explorer öffnen**, **Workbench schließen** und **Aus Liste entfernen**.
- **Aus Liste entfernen** entfernt nur den Eintrag; es wird keine Datei gelöscht.
- Wurde ein Ordner verschoben oder gelöscht, zeigt sein Eintrag **Ordner fehlt**. Entfernen Sie ihn aus der Liste oder öffnen Sie den Ordner an seinem neuen Ort.
- **Sitzungen anzeigen** und **Sitzungen ausblenden** klappen die Sitzungen eines Workbenchs in der Seitenleiste auf oder zu.

Wählen Sie den Namen eines Workbenchs, um seine **Workbench-Übersicht** zu sehen: das Konversationsmodell, den Berechtigungsmodus, die indizierten und ausgeschlossenen Quellen und die Sitzungen.

## Einen Workbench bearbeiten

Wählen Sie **Workbench bearbeiten** in der Übersicht oder im Zeilenmenü. Ändern Sie die Abschnitte und wählen Sie dann oben rechts **Speichern**; **Abbrechen** verwirft Ihre Änderungen. Wenn Sie die Seite mit ungespeicherten Änderungen verlassen, fragt VERA zuerst nach.

| Abschnitt | Was er festlegt |
|---|---|
| **Allgemein** | Name und Beschreibung |
| **Oberfläche** | Sichtbarkeit der **Tabs im rechten Bereich** |
| **Dokumente & RAG** | Welche Ordner und Dateien indiziert werden |
| **Agent und Chat** | Standardmodell, Standard-Berechtigungsmodus, **Detailgrad** |
| **Anweisungen** | Der Text von `.vera/WORKBENCH.md`, den der Agent in jeder Sitzung liest |
| **Werkzeuge** | Allgemeine VERA-Werkzeuge: Dateien, Suche, Dokumente, Planung, Skills/Hilfe, Terminal und allgemeine Ausführung |
| **Skills** | Skills des Workbenchs und des Benutzers: aktivieren, erstellen und bearbeiten |
| **Indizierung** | Embedding-Einstellungen und die Standardwerte der Dokumentsuche des Agenten |
| **Plugins** | Aktivierte Plugins, ihre spezialisierten Werkzeugfreigaben und Programme sowie gemeinsame Elektro- / Automatisierungswerkzeuge |

Halten Sie die Anweisungen kurz und sachlich: das Board, der Mikrocontroller, die Toolchain, Konventionen. Nur die ersten 16 KB werden an den Agenten übergeben; VERA warnt, wenn der Text länger ist.

## Skills

Skills sind wiederverwendbare Agentenanweisungen, keine Befehle. Öffnen Sie **Workbench bearbeiten > Skills** oder **Skills** im Sitzungstab **Anweisungen und Skills**. **Aktiviert** macht Anweisungen in dieser Workbench verfügbar, ohne sie auszuführen. Die Aktivierung wird sofort gespeichert; Schließen des Panels oder Abbrechen anderer Workbench-Änderungen macht sie nicht rückgängig.

Wählen Sie **Skill erstellen**, geben Sie einen Namen aus Kleinbuchstaben (a–z), Ziffern und Bindestrichen ein (1–64 Zeichen) und wählen Sie **Diese Workbench** oder **Alle meine Workbenches**. Letzteres speichert den Skill im aktuellen VERA-Benutzerprofil, ohne ihn automatisch mit anderen Benutzern oder Installationen zu teilen. **Erstellen und bearbeiten** öffnet eine Vorlage: Beschreibung und Ablauf ergänzen, dann speichern. **Abbrechen** verwirft unfertige Änderungen, nicht den bereits erstellten Skill.

Workbench- und Benutzer-Skills bieten **Anweisungen bearbeiten**. Offizielle und Plugin-Skills bieten schreibgeschütztes **Anweisungen anzeigen**. **Liste aktualisieren** liest die Liste neu; **Erneut versuchen** erscheint nur nach einem Fehler und wiederholt diese Operation. Schreibgeschützte Workbenches erlauben Aktualisieren und Anzeigen, aber keine Änderungen. **Schließen** oder Escape schließt den Dialog; Escape verwirft zuerst ein geöffnetes Erstellungs- oder Bearbeitungsformular.

## Tabs im rechten Bereich

Öffnen Sie **Workbench bearbeiten > Oberfläche > Tabs im rechten Bereich**. Wählen Sie die sichtbaren Tabs: Anweisungen und Skills, Dateien, Änderungen, Artefakte, Plan, Lesezeichen, Läufe und Terminal. Standardmäßig sind alle außer **Lesezeichen** ausgewählt; diesen Tab schalten Sie selbst ein. **Standard wiederherstellen** wählt im Entwurf alle außer Lesezeichen aus; **Speichern** übernimmt den Entwurf, **Abbrechen** verwirft ihn.

Speichern aktualisiert sofort alle Sitzungen dieses Workbenchs, auch nach erneutem Öffnen oder einem Neustart von VERA. Andere Workbenches behalten ihre eigene Auswahl. Wird der aktive Tab ausgeblendet, wird der erste verbleibende Tab in der üblichen Reihenfolge ausgewählt. Sind alle ausgeblendet, schließt sich der rechte Bereich und die übliche Öffnen-Schaltfläche entfällt. **Tabs im rechten Bereich** bleibt auf der Hauptseite erreichbar; der Editor ist auch über Übersicht und Seitenleistenmenü zugänglich.

Pfeiltasten, Pos1 und Ende besuchen nur sichtbare Tabs. Die Terminal-Tastenkombination blendet keinen versteckten Tab ein, sondern bietet einen Link zu diesen Einstellungen. Ausblenden ändert nur die Darstellung: Anweisungen, Dateien, Änderungen, Artefakte, Pläne und Verlauf bleiben erhalten, Agentenwerkzeuge arbeiten weiter und laufende Terminals und Programme werden nicht beendet. Schließen bleibt im angezeigten Bereich verfügbar und ist kein konfigurierbarer Tab.

## Schreibgeschützte Workbenches

Ein Workbench wird schreibgeschützt geöffnet, wenn ein anderer VERA-Prozess ihn bereits geöffnet hat, zum Beispiel eine zweite VERA-Installation. Sie können Sitzungen lesen, Dateien durchsuchen und öffnen sowie Sitzungen exportieren, aber keine Nachrichten senden und keine Einstellungen speichern. Schließen Sie die andere Instanz und öffnen Sie den Workbench erneut, um darin zu arbeiten.

## Der Ordner .vera

| Element | Inhalt |
|---|---|
| `workbench.yaml` | Die Konfiguration des Workbenchs; bearbeiten Sie sie über **Workbench bearbeiten** |
| `WORKBENCH.md` | Die Anweisungen für den Agenten |
| `.veraignore` | Optionale Regeln für Dateien, die der Agent und der Index nicht sehen dürfen |
| `skills/` | Skills dieses Workbenchs |
| `plugins/` | Plugin-Pakete, die mit dem Projekt geteilt werden |
| `vera.db` | Sitzungen, Freigaben, Änderungen und der Dokumentindex |
| `artifacts/`, `downloads/`, `runs/` | Sitzungsartefakte, heruntergeladene Dateien, Protokolle von Programmläufen |

`.vera/` enthält eine `.gitignore`, die nur die Konfiguration, die Anweisungen, `.veraignore` und die Skills unter Versionskontrolle hält. Der Agent kann `workbench.yaml` und `.vera/plugins` in keinem Berechtigungsmodus ändern.

`.veraignore` verwendet dieselbe Mustersyntax wie `.gitignore`. Die Ordner `.vera`, `.git` und `node_modules` werden immer ignoriert.

## Zusätzliche Ordner

Unter **Workbench bearbeiten > Allgemein > Zusätzliche Ordner** wählen Sie **Ordner hinzufügen** und einen absoluten Ordner, etwa ein benachbartes Repository. **Speichern** erteilt Zugriff; **Abbrechen** verwirft die Auswahl. Die Übersicht zeigt gespeicherte Ordner. Entfernen und Speichern widerruft den Zugriff sofort, auch für wartende Vorgänge. Schreibgeschützte Workbenches können diese Freigaben nicht ändern.

Die normalen Werkzeuge read, list, glob, grep, write und edit sowie Shell-Arbeitsordner nutzen diese Ordner mit denselben Freigaben für Fragen oder Automatisch bearbeiten wie der Workbench. Externe Pfade müssen absolut sein; relative Pfade beginnen weiter im Haupt-Workbench. Externe Quellen haben absolute Identitäten ohne lokale Dokumentzitate. Ignorierregeln bleiben aktiv; VERA-Anwendungsdaten sind auch über Verknüpfungen gesperrt. Hinzufügen indiziert die Ordner nicht: Index, Protokolle, Artefakte und erzeugte Daten bleiben im Haupt-Workbench. Befehle behalten die Rechte des Systemkontos und laufen ohne Sandbox.

## Daten & Datenschutz

Wählen Sie Standard, Ein oder Aus für jeden Maskierungsbereich und dann oben rechts Speichern oder Abbrechen. Standard zeigt und übernimmt den App-Wert; jeder Workbench behält eigene Werte. Unter [Einstellungen](settings.md) stehen die Warnung zum Modellanbieter und die Grenzen gespeicherter Verläufe.
