# Raspberry-Pi-Linux-Projekte

Mit diesem Plugin arbeitet der Agent auf einem Raspberry Pi, den VERA über SSH erreicht: ein Projekt übertragen, seine Aufgaben ausführen und ihre Ausgabe zeigen, einen Befehl ausführen, Python- und Systempakete installieren, Dienste verwalten, die beim Booten starten, den Zustand des Boards lesen und Dateien zurückholen. VERA verbindet sich wie `ssh`, mit dem Schlüssel, den Sie bereits verwenden.

## Voraussetzungen

- **pi-tool**, ein Python-Skript, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- **Ein Raspberry Pi** mit Raspberry Pi OS 12 (Bookworm) 64-Bit, aktiviertem SSH und Python 3.9 oder neuer.
- **Das Laborregister** `lab/resources.json` in der Workbench (erforderlich), das das Board als `linux-board` deklariert. Host und Benutzer genügen; der Agent schreibt den Eintrag, wenn Sie beides nennen.
- **Ein SSH-Schlüssel**: ein Schlüssel im SSH-Agenten oder ein privater Schlüssel in `~/.ssh` ohne Passphrase, dessen öffentliche Hälfte auf dem Board autorisiert ist. VERA verarbeitet nie ein Passwort oder eine Passphrase.
- **Ein Projektmanifest** `vera-pi.json` in einem Projektordner (optional): die zu übertragenden Dateien, die Python-Abhängigkeiten, die Aufgaben und die Dienste.

Der Abschnitt **Konfiguration** der Plugin-Seite zeigt den Zustand jedes Punkts.

## Verwendung

Der Agent verwendet die Skills `raspberry-pi-projects` und `raspberry-pi-tasks`.

- „Mein Pi heißt raspberrypi.local, Benutzer pi. Verbinden Sie sich und sagen Sie mir, wie es ihm geht.“
- „Führen Sie das Projekt blink auf pi aus.“
- „Installieren Sie i2c-tools auf pi und durchsuchen Sie den I2C-Bus.“
- „Lassen Sie blink beim Booten starten und zeigen Sie mir seine Logs.“

Die erste Verbindung speichert den Host-Schlüssel des Boards. Wenn Sie das System des Boards neu installieren, ändert sich der Schlüssel, und VERA lehnt ihn ab, bis Sie den Agenten anweisen, dem neuen zu vertrauen.

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Offline-Prüfungen des Manifests und Berichte.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Prüfen des Host-Schlüssels, Identität und Zustand des Boards, Vergleich eines Projekts mit dem Board, Status von Aufgaben und Diensten, Logs und das Holen einer Datei.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Übertragen von Dateien (keine wird gelöscht), Ausführen einer Aufgabe oder eines Befehls, Starten oder Stoppen eines Dienstes, Annehmen eines neuen Host-Schlüssels und das Aufräumen durch VERA. Projektcode und Befehle können am Board angeschlossene Hardware ansteuern. **Immer erlauben** auf der Karte lässt einen Befehl wie `pi-tool run-task` in **Auto-Edit** ohne Rückfrage laufen.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Übertragen mit `--overwrite`, das auf dem Board bearbeitete Dateien ersetzt; diese Änderungen gehen verloren. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

## Grenzen

- VERA läuft unter Windows x64 oder Linux x64; für andere Boards als einen Raspberry Pi wird keine Unterstützung zugesichert.
- Ein Befehl, der `sudo` braucht, funktioniert nur dort, wo das Board es ohne Passwort erlaubt, wie beim Standardbenutzer von Raspberry Pi OS.
- `~/.ssh/config` wird nicht gelesen: Tragen Sie den echten Host und Benutzer des Boards in das Register ein.
- Das Plugin ist noch nicht gegen einen echten Raspberry Pi gelaufen.
