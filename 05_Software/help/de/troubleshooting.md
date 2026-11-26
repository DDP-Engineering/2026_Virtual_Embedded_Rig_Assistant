# Fehlerbehebung

## Der Agent antwortet nicht

- Öffnen Sie **Einstellungen** → **Anbieter** und wählen Sie **Testen** an der Verbindung, die die Sitzung verwendet. Der fehlgeschlagene Schritt zeigt Ihnen, wo Sie suchen müssen; siehe [Anbieter und Modelle](providers.md).
- **… ist nicht erreichbar**: Der lokale Server läuft nicht, oder die Adresse oder das Netzwerk ist falsch.
- **Authentifizierung fehlgeschlagen**: Geben Sie den Schlüssel erneut ein oder melden Sie sich erneut mit ChatGPT an.
- **Das Kontextlimit wurde erreicht**: Kürzen Sie die Eingabe, starten Sie eine neue Sitzung oder korrigieren Sie das Kontextfenster einer benutzerdefinierten Verbindung.
- Ein hängender Durchlauf lässt sich jederzeit mit **Stoppen** beenden.

## Der Workbench ist schreibgeschützt

Die Meldung **Dieser Workbench ist schreibgeschützt, da ein anderer Prozess oder eine Sperre ihn besitzt.** bedeutet, dass ein anderer VERA-Prozess den Workbench geöffnet hat. Schließen Sie diesen und öffnen Sie den Workbench erneut. Ein Workbench auf einer Netzwerkfreigabe wird nicht unterstützt; verschieben Sie ihn auf ein lokales Laufwerk.

## Der Agent findet etwas in den Dokumenten nicht

1. Öffnen Sie den Tab **Dateien** und sehen Sie sich den Status des Dokuments an.
2. **OCR erforderlich**: Das PDF ist ein Scan ohne Text. Verwenden Sie ein PDF mit Textebene.
3. **Fehlgeschlagen** oder **Nicht unterstützt**: Der Grund wird am Dokument und unter **Eigenschaften** angezeigt. Ältere `.doc`-, `.ppt`- und `.xls`-Dateien werden nicht indiziert.
4. Das Dokument ist gar nicht gekennzeichnet: Es liegt außerhalb der indizierten Ordner. Fügen Sie seinen Ordner unter **Workbench bearbeiten** → **Dokumente & RAG** hinzu und prüfen Sie, dass weder `.vera/.veraignore` noch, wenn **.gitignore verwenden** aktiviert ist, eine `.gitignore`-Datei es ausschließt.
5. Wählen Sie **Neu indizieren**. Wurde die Indizierung angehalten, wählen Sie **Indexierung neu starten**.

Siehe [Dokumente und Suche](documents-and-search.md).

## Ein Quellenverweis konnte nicht überprüft werden

Die zitierte Datei wurde nach der Antwort geändert oder entfernt, oder der Agent hat etwas zitiert, das er nicht gelesen hat. Bitten Sie den Agenten, erneut nachzusehen.

## Der Agent verwendet ein Plugin nicht

- Ist das Plugin für diesen Workbench aktiviert? Prüfen Sie **Workbench bearbeiten** → **Plugins**.
- Zeigt sein **Status** **Bereit** an? Andernfalls wählen Sie **Abhängigkeiten prüfen**, installieren Sie, was fehlt, und vervollständigen Sie seine **Konfiguration**.
- Im Modus **Nur lesen** laufen nur sichere Befehle; Befehle mit der Einstufung **Gesperrt** laufen nie. Siehe [Berechtigungen](permissions.md).
- **Auf diesem Computer nicht vertrauenswürdig** oder **Die Dateien des Plugins haben sich seit der Prüfung geändert; installieren Sie es erneut.**: Prüfen Sie das Plugin und installieren Sie es erneut.
- Ein Programm verhält sich nicht wie erwartet: Öffnen Sie den Tab **Läufe** und wählen Sie **Protokoll öffnen**.

Siehe [Plugins](plugins.md).

## Der Plugin-Katalog wird nicht angezeigt

Ist der Katalog nicht erreichbar oder stimmt seine Signatur nicht überein, zeigt die Seite **Plugins** stattdessen die mit VERA ausgelieferten Plugins. Prüfen Sie das Netzwerk und die **Katalog-URL** unter **Katalogeinstellungen**, oder verwenden Sie **Standard verwenden**.

## Aktualisierungen

- **Aktualisierung wartet auf das Ende aller Durchläufe und Freigaben.**: Schließen Sie die laufenden Sitzungen ab oder stoppen Sie sie.
- **Der Update-Feed ist nicht erreichbar.**: Prüfen Sie das Netzwerk und wählen Sie dann **Jetzt prüfen**.
- Portable und Linux-`.deb`-Installationen installieren Updates nicht selbst; siehe [Einstellungen](settings.md).

## VERA schließt sich direkt nach dem Start

Ist die Datei `settings.json` ungültig, zeigt VERA beim Start ihren Pfad und die betroffenen Einstellungen an. Korrigieren oder verschieben Sie die Datei, um die Standardeinstellungen neu anzulegen. Richten Sie anschließend Ihre Anbieter und Einstellungen erneut ein.

## Protokolle

VERA schreibt eine Protokolldatei pro Tag, `vera-YYYY-MM-DD.log`, in den Ordner `logs` seines Datenordners und behält die neuesten sieben oder die unter **Aufbewahrung der Logs** in den [erweiterten Einstellungen](advanced-settings.md) gesetzte Zahl. Schlüssel und andere bekannte Geheimnisse werden aus den Protokollen entfernt. Die Programmausgabe von Plugins steht nicht in diesen Protokollen, sondern in `.vera/runs/` des Workbenchs.

## Wo VERA seine Daten ablegt

Die Anwendungsdaten liegen in einem Ordner:

| Installation | Ordner |
|---|---|
| Windows | `%APPDATA%\VERA\` |
| Linux | `~/.config/VERA/` |
| Portabel | `data` neben `vera.exe` |

| Element | Inhalt |
|---|---|
| `settings.json` | Einstellungen, Anbieterverbindungen ohne Schlüssel, zuletzt verwendete Workbenches |
| `credentials.json` | Schlüssel und Anmeldetokens, verschlüsselt, soweit das System es erlaubt |
| `logs/` | Tägliche Protokolldateien |
| `plugins/` | Installierte Plugins und die Programme, die VERA für sie installiert hat |
| `window-state.json` | Fenstergröße und -position |

Alles, was zu einem Projekt gehört, etwa Sitzungen, der Dokumentindex, Artefakte, Downloads und Laufprotokolle, liegt im eigenen Ordner `.vera/` des Workbenchs; siehe [Workbenches](workbenches.md).
