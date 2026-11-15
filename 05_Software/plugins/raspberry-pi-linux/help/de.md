# Raspberry-Pi-Linux-Projekte

Dieses Plugin ermöglicht dem Agenten, Projekte zu übertragen, begrenzte Aufgaben auszuführen und Benutzerdienste auf einem Raspberry Pi zu verwalten, den VERA über SSH erreicht. Jede Verbindung prüft den festgelegten Host-Schlüssel, die Identität, den Benutzer und das Remote-Stammverzeichnis des Boards. Ein kleines Hilfsprogramm auf dem Board wendet nur freigegebene Dateien an, führt deklarierte Aufgaben mit einem Zeitbudget aus und startet, stoppt und liest aufgelistete Benutzerdienste. Es gibt keinen Zugriff auf Shell, sudo, Systemdienste, Raw-GPIO, I2C oder SPI und keinen Neustart.

## Voraussetzungen

- **pi-tool**, ein Python-Skript, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- **Ein Raspberry Pi** mit Raspberry Pi OS 12 (Bookworm) 64-Bit, einem nicht privilegierten Benutzer mit systemd-Benutzerinstanz und Python 3.9 oder neuer.
- **Das Laborregister** `lab/resources.json` in der Workbench (erforderlich), das das Board als `linux-board` deklariert: Host, Benutzer, festgelegte Fingerabdrücke des Host-Schlüssels, Agent-Schlüssel, Seriennummer oder Machine-ID und Remote-Stammordner.
- **Ein Projektmanifest** `vera-pi.json` in einem Projektordner (optional): die zu übertragenden Dateien, die Aufgaben und die Benutzerdienste.
- **Der SSH-Agent des Systems** mit Ihrem Anmeldeschlüssel (unter Windows der OpenSSH Authentication Agent oder Pageant). VERA verarbeitet nie ein Passwort oder eine Schlüsseldatei.

Der Abschnitt **Konfiguration** der Plugin-Seite zeigt den Zustand jedes Punkts.

## Verwendung

Der Agent verwendet die Skills `raspberry-pi-projects` und `raspberry-pi-tasks`. Vergleichen Sie den Host-Schlüssel an der eigenen Konsole des Boards, bevor Sie ihn festlegen.

- „Prüfen Sie den Host-Schlüssel des Boards pi, installieren Sie dann das Hilfsprogramm und identifizieren Sie das Board.“
- „Stellen Sie blink/vera-pi.json auf pi bereit und zeigen Sie mir, welche Dateien sich ändern.“
- „Führen Sie die Aufgabe selftest von blink-demo auf pi aus.“
- „Starten Sie blink-demo.service und sammeln Sie seine Logs.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Offline-Prüfungen des Manifests und Berichte.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Prüfen des Host-Schlüssels, Identifizieren des Boards, Status und Logs von Aufgaben und Diensten.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Installieren des Hilfsprogramms, Bereitstellen und Anwenden von Dateien (keine wird gelöscht), Ausführen einer Aufgabe, Starten oder Stoppen eines Dienstes und das Aufräumen durch VERA. Projektcode kann am Board angeschlossene Hardware ansteuern.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Anwenden mit `--overwrite`, das auf dem Board bearbeitete Dateien ersetzt; diese Änderungen gehen verloren. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

## Grenzen

- VERA läuft unter Windows x64 oder Linux x64; für andere Boards wird keine Unterstützung zugesichert.
- Ein geänderter Host-Schlüssel wird abgelehnt, nie akzeptiert.
- Ein Dienst, der nach der Sitzung weiterläuft, braucht auf dem Board `loginctl enable-linger <user>`, was VERA nie ausführt.
- Das Plugin ist noch nicht gegen einen echten Raspberry Pi gelaufen.
