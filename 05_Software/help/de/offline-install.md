# Offline-Installation

VERA lässt sich auf einem Laborrechner ohne Netzwerk installieren und verwenden. Das Installationsprogramm enthält alles, was die Anwendung benötigt: das lokale Indizierungsmodell, den Python-Werkzeuginstaller und den offiziellen Plugin-Katalog. Die Programme, die Plugins ausführen, werden separat in einem Offline-Abhängigkeits-Kit geliefert. Die Laufzeit des interaktiven Browsers und die Diktatmodelle werden ebenfalls separat geliefert, im Ordner `components/`. KI-Modelle benötigen weiterhin einen Anbieter: Verwenden Sie auf einem Computer ohne Netzwerk einen lokalen Server wie LM Studio oder Ollama (siehe [Anbieter und Modelle](providers.md)).

## Der Lieferordner

Eine VERA-Lieferung ist ein Ordner pro Version, `vera-<version>/`:

| Ordner | Inhalt |
|---|---|
| `vera-windows-x64/` | `VERA-<v>-win-x64.exe` (Installationsprogramm), `VERA-<v>-win-x64.zip` (portabel), `SHA256SUMS` |
| `vera-linux-x64/` | `VERA-<v>-linux-*.AppImage`, `VERA-<v>-linux-*.deb`, `SHA256SUMS` |
| `plugins/` | Ein `<id>-<version>.zip` pro Plugin, die Katalogindizes, `vera-plugins-<version>.zip` mit dem gesamten Katalog, `SHA256SUMS` |
| `plugin-deps/` | `vera-plugin-deps-<version>-windows-x64.zip` und `…-linux-x64.zip`, `SHA256SUMS` |
| `components/` | `chrome-win64.zip` und `chrome-linux64.zip` (Browser-Laufzeit), `whisper-base.zip` und `whisper-small.zip` (Diktatmodelle), `THIRD-PARTY-NOTICES.md`, `SHA256SUMS` |
| `delivery.json` | Was gebaut wurde: Versionen, Dateien, Größen und SHA-256 |

Kopieren Sie den Ordner Ihrer Plattform und `plugin-deps/`, wenn Sie Plugin-Programme verwenden möchten. `plugins/` wird nur für Plugins benötigt, die neuer sind als Ihr VERA-Installationsprogramm. Das Abhängigkeits-Kit ist etwa 1 GB pro Plattform groß. Kopieren Sie auch `components/`, wenn Sie den interaktiven Browser oder das Diktat verwenden möchten. Der Ordner umfasst für beide Plattformen und beide Modelle etwa 700 MB.

## 1. Die Dateien prüfen

Vergleichen Sie jede Datei mit ihrer Zeile in `SHA256SUMS`:

- Linux: Führen Sie in jedem Ordner `sha256sum -c SHA256SUMS` aus.
- Windows (PowerShell): Führen Sie `Get-FileHash <file> -Algorithm SHA256` aus und vergleichen Sie den Hash mit der Zeile in `SHA256SUMS`.

Installieren Sie keine Datei, deren Hash abweicht; kopieren Sie sie erneut.

## 2. VERA installieren

- Windows-Installationsprogramm: Führen Sie `VERA-<v>-win-x64.exe` aus. Es installiert für Ihren Benutzer und benötigt keine Administratorrechte.
- Windows portabel: Entpacken Sie `VERA-<v>-win-x64.zip` und starten Sie `vera.exe`. Einstellungen und Daten bleiben im Ordner `data` daneben.
- Linux: `sudo apt install ./VERA-<v>-linux-amd64.deb`, oder machen Sie das AppImage mit `chmod +x` ausführbar und starten Sie es.

## 3. Plugins installieren

Die Seite **Plugins** listet die offiziellen Plugins Ihrer VERA-Version aus dem Katalog im Installationsprogramm auf; installieren Sie sie dort wie gewohnt (siehe [Plugins](plugins.md)). Für ein neueres Plugin aus der Lieferung wählen Sie **Aus ZIP installieren…** und dann `plugins/<id>-<version>.zip`.

## 4. Plugin-Programme offline bereitstellen

1. Entpacken Sie `vera-plugin-deps-<version>-<platform>.zip` in einen lokalen Ordner. Der entpackte Ordner enthält `kit.json`.
2. Schließen Sie VERA.
3. Öffnen Sie die `settings.json` von VERA in einem Texteditor. Sie liegt unter Windows in `%APPDATA%\VERA\`, unter Linux in `~/.config/VERA/` und bei der portablen Version im Ordner `data`.
4. Fügen Sie die Einstellung `plugins.kit` mit dem absoluten Pfad des entpackten Ordners hinzu, zum Beispiel:

   ```json
   "plugins": { "kit": "D:\\vera-plugin-deps-<version>-windows-x64" }
   ```

   Hat `settings.json` bereits einen Eintrag `plugins`, fügen Sie `kit` darin ein. Schreiben Sie in JSON jeden Backslash doppelt.
5. Starten Sie VERA, öffnen Sie das Plugin auf der Seite **Plugins** und wählen Sie **Abhängigkeiten installieren**.

VERA prüft jede Datei aus dem Kit anhand des SHA-256 im Manifest des Plugins und weist eine veränderte Datei zurück. Um wieder aus dem Netzwerk zu installieren, entfernen Sie `plugins.kit`.

Um ein einzelnes Programm aus einem selbst kopierten Archiv zu installieren, verwenden Sie stattdessen **Aus Abhängigkeitsarchiv installieren…** auf der Karte des Plugins.

## 5. Browser-Laufzeit und Diktatmodelle offline installieren

1. Öffnen Sie **Einstellungen → Webzugriff** und wählen Sie **Aus Datei installieren…**. Wählen Sie unter Windows `components/chrome-win64.zip` oder unter Linux `components/chrome-linux64.zip`.
2. Öffnen Sie **Einstellungen → Diktat** und wählen Sie beim gewünschten Modell **Aus Datei installieren…**. Wählen Sie `components/whisper-base.zip` oder `components/whisper-small.zip`.

VERA prüft jede Datei anhand des SHA-256, den seine Version festlegt, weist eine veränderte oder andere Datei zurück und stellt keine Netzwerkanfrage. `THIRD-PARTY-NOTICES.md` nennt Quelle und Lizenz jeder Komponente.

## Herstellerprogramme

Herstellerprogramme wie KiCad, LTspice oder STM32CubeProgrammer sind nie Teil des Kits. Die `README.md` des Kits listet jedes davon mit seiner Downloadseite auf. Installieren Sie sie mit dem Installationsprogramm des Herstellers und wählen Sie dann **Abhängigkeiten prüfen** am Plugin.
