# Berechtigungen

Der Berechtigungsmodus legt fest, was der Agent tun darf, ohne Sie zu fragen: Dateien ändern, Dateien herunterladen und Plugin-Programme an Ihrem Laborplatz ausführen. Das Lesen der Workbench, das Durchsuchen von Dokumenten und das Speichern von Artefakten erfordern nie eine Freigabe.

## Einen Modus wählen

Wählen Sie den Modus mit **Berechtigungsmodus** neben dem Nachrichtenfeld. Er gilt für diese Sitzung und kann jederzeit geändert werden, auch während eines Durchlaufs. Neue Sitzungen starten mit dem Standard der Workbench aus **Workbench bearbeiten** → **Agent und Chat** → **Berechtigungen**; eine neue Workbench startet mit **Nachfragen**.

| Modus | Dateiänderungen | Programme |
|---|---|---|
| **Nur lesen** | Nicht erlaubt; der Agent hat keine Schreibwerkzeuge | Nur Befehle mit der Einstufung **Sicher** |
| **Nachfragen** | Jede Änderung wartet auf Ihre Freigabe | **Gerät lesen** und **Gerät schreiben** fragen nach; **Irreversibel** fragt mit einem einzutippenden Wort nach |
| **Auto-Edit** | Änderungen in der Workbench werden ohne Nachfrage angewendet; Downloads fragen weiterhin nach; Dateien in `.vera/` können nicht geändert werden | **Gerät lesen** läuft; **Gerät schreiben** fragt nach; **Irreversibel** fragt mit einem einzutippenden Wort nach |
| **Bypass — voller Zugriff** | Liest und ändert Dateien überall, wo Ihr Konto Zugriff hat, ohne Nachfrage | Alles außer **Gesperrt** läuft ohne Nachfrage |

Ein Wechsel in einen strengeren Modus widerruft Freigaben, die der Agent im vorherigen Modus erhalten hat.

## Bypass

Jeder Wechsel zu Bypass verlangt zuerst Ihre Bestätigung, dass der Agent Dateien lesen und ändern sowie Programme in jedem Ordner ausführen kann, auf den Ihr Betriebssystemkonto zugreifen kann, auch außerhalb der Workbench. Wählen Sie **Bypass aktivieren**, um den Wechsel anzuwenden. **Abbrechen** oder Escape behält den bisherigen Modus bei. Jeder erneute Wechsel zu Bypass fragt wieder nach, auch nach einem Neustart von VERA; der ausgewählte Modus bleibt rot markiert. Dieselbe Bestätigung listet irreversible Regeln aktivierter, fehlerfreier Plugins auf, die keine Test-Plugins sind.

Der Anwendungsdatenordner von VERA mit Einstellungen, gespeicherten Zugangsdaten, installierten Plugins und Prüfprotokollen ist für Dateizugriffe des Agenten in jedem Modus gesperrt, sowohl zum Lesen als auch zum Schreiben, auch über Pfad-Aliase. VERA verwaltet seine eigenen Einstellungen und Plugins weiterhin normal. Nur aktivierte Werkzeuge sind verfügbar; Betriebssystemrechte, Werkzeuggrenzen und Freigaben für Test-Plugins gelten weiterhin. Der Agent kann `.vera/workbench.yaml` und `.vera/plugins` nicht ändern.

Allgemeine Dateiwerkzeuge und deklarierte Programme erreichen im Bypass externe Pfade. Arbeitsverzeichnisse dürfen absolute externe Pfade sein; vorhandene externe Dateiargumente werden mit ihrem absoluten Pfad gebunden und vor dem Start erneut geprüft. Ask, Auto-edit und Read-only verweigern externe Arbeitsverzeichnisse und erkannte externe Datei- oder Verzeichnisargumente. Externe Verzeichnisargumente erscheinen als absolute Pfade, auch bei Aliasen; ihre Inhalte werden nicht gehasht. Beim Verlassen von Bypass enden seine Programmläufe, auch Hintergrundläufe nach dem Zugende. Deklarierte Kindprogramme laufen ohne Sandbox. Auch die Analyse erfasster Protokolle und Register, Prüfung und Installation von Plugin-Entwürfen, Kandidateneingaben, HIL-Pläne und Firmware, Prüfstandressourcen und elektrische Eingaben folgen Bypass. Absolute externe Pfade und kanonische Aliase sind nur in Bypass erlaubt; Kennungsselektoren bleiben Kennungen. Externe Analysequellen zeigen kanonische absolute Pfade ohne Links zu indizierten Dokumenten. Plugin-Installationen erfordern weiterhin eine Prüfung. Feste elektrische Modelle und Ergebnisse, erzeugte HIL-Anfragen, Dokumentindex, Artefakte, Laufprotokolle und `.vera/` bleiben in der Workbench. Das Verlassen von Bypass beendet laufende Analysen und HIL-Arbeiten, auch im Hintergrund.

HIL löst relative Plan-, Firmware-, Quellen- und Ressourceneingaben vom gewählten Arbeitsverzeichnis aus auf; erzeugte Anfragen und Ergebnisse bleiben in der Workbench.

## Genehmigen oder ablehnen

Braucht der Agent Ihre Entscheidung, erscheint eine Freigabekarte in der Unterhaltung, und die Sitzung zeigt **Wartet auf Freigabe**.

- Bei einer Dateiänderung zeigt die Karte die Datei und einen **Unified Diff** der Änderung.
- Bei einem Download zeigt sie die Quelladresse und die maximale Größe.
- Bei einem Programm zeigt sie die Risikostufe, **Plugin**, **Befehlszeile**, **Arbeitsverzeichnis**, **Programmdatei**, **Hinweise der Regeln** und die verwendeten Dateien, mit absoluten Pfaden für externe Dateien, mit ihrem SHA-256.

Wählen Sie **Genehmigen** oder **Ablehnen**. **Genehmigen und zu Auto-Edit wechseln** genehmigt und stellt die Sitzung auf **Auto-Edit** um. Hat die Karte den Fokus, genehmigt A und D lehnt ab.

Bei einem irreversiblen Befehl weist die Karte darauf hin, dass die Änderung dauerhaft ist, und nennt ein Wort, meist den Befehl, zum Beispiel `burn-efuse`. Tippen Sie dieses Wort ein und genehmigen Sie dann. Stimmt das Wort nicht überein, wartet die Karte weiter.

## Risikostufen von Programmen

Jedes Plugin stuft seine Befehle ein. VERA gleicht die exakte Befehlszeile mit diesen Regeln ab, bevor etwas ausgeführt wird.

| Stufe | Bedeutung |
|---|---|
| **Sicher** | Liest nichts von einem Gerät und ändert nichts, zum Beispiel die Ausgabe einer Version |
| **Gerät lesen** | Liest von einem angeschlossenen Gerät, zum Beispiel eine Chip-ID oder Speicher |
| **Gerät schreiben** | Schreibt auf ein Gerät, zum Beispiel Flashen oder Löschen |
| **Irreversibel** | Verändert ein Gerät dauerhaft, zum Beispiel durch Brennen von eFuses oder Sperren |
| **Gesperrt** | Läuft nie, in keinem Modus |

Ein Befehl, auf den keine Regel passt, gilt als **Gerät schreiben**. Passen mehrere Regeln, gilt die höchste Stufe. Die Regeln eines Plugins sehen Sie vor der Installation in seinem Abschnitt **Operationen**; siehe [Plugins](plugins.md).

## Änderungen prüfen

Der Tab **Änderungen** im rechten Bereich listet die in der Sitzung geänderten Dateien der Reihe nach auf, mit der Anzahl hinzugefügter und entfernter Zeilen. Wählen Sie einen Eintrag, um seinen Diff zu sehen; **Im Ordner anzeigen** zeigt die Datei in Ihrem Dateimanager. Siehe auch [Chat und Sitzungen](chat-and-sessions.md).

## Shell-Befehle

Der Agent führt Shell-Befehle mit `run_command` aus. Fragen und Befehle ohne erlaubtes Präfix in Automatisch bearbeiten verlangen eine Freigabe; die Karte zeigt den genauen Befehl, Arbeitsordner und die Shell. Bypass führt ohne Nachfrage aus. Nur lesen bietet keine Befehle an. Befehle haben die Rechte deines Betriebssystemkontos und laufen ohne Sandbox. Außerhalb von Bypass bleibt der Arbeitsordner in der Workbench oder einem gespeicherten zusätzlichen Ordner; VERA-Anwendungsdaten sind in jedem Modus als Arbeitsordner gesperrt. Shell-Syntax kann auf Dateien und Programme außerhalb des anfänglichen Arbeitsordners zugreifen.

Fragen verlangt für jeden Befehl eine Freigabe. In Automatisch bearbeiten speichert Immer erlauben das gewählte wörtliche Befehlspräfix für diese Workbench; npm test erlaubt beispielsweise auch npm test -- --watch=false. Workbench bearbeiten > Agent listet die Präfixe; nach Entfernen und Speichern wird sofort wieder gefragt. Rekursives Löschen, erzwungenes Pushen, Hard-Resets, Formatieren und Datenträgerwerkzeuge fragen außerhalb von Bypass immer nach und können nicht gespeichert werden. Komplexe Syntax, Anführungszeichen, Escape-Zeichen, Pipes, Ersetzungen und Befehlstrenner verlangen ebenfalls eine ausdrückliche Freigabe. Präfixe erlauben Argumente; sie isolieren die Wirkung von Skripten nicht. Gespeicherte Geheimnisse im Präfix bleiben maskiert; Entfernen löscht die Freigabe auch bei maskierter Anzeige.

## Zusätzliche Ordner

Unter **Workbench bearbeiten > Allgemein > Zusätzliche Ordner** wählst du **Ordner hinzufügen** und einen absoluten Ordner, etwa ein benachbartes Repository. **Speichern** erteilt Zugriff; **Abbrechen** verwirft die Auswahl. Die Übersicht zeigt gespeicherte Ordner. Entfernen und Speichern widerruft den Zugriff sofort, auch für wartende Vorgänge. Schreibgeschützte Workbenches können diese Freigaben nicht ändern.

Die normalen Werkzeuge read, list, glob, grep, write und edit sowie Shell-Arbeitsordner nutzen diese Ordner mit denselben Freigaben für Fragen oder Automatisch bearbeiten wie die Workbench. Externe Pfade müssen absolut sein; relative Pfade beginnen weiter in der Haupt-Workbench. Externe Quellen haben absolute Identitäten ohne lokale Dokumentzitate. Ignorierregeln bleiben aktiv; VERA-Anwendungsdaten sind auch über Verknüpfungen gesperrt. Hinzufügen indiziert die Ordner nicht: Index, Protokolle, Artefakte und erzeugte Daten bleiben in der Haupt-Workbench. Befehle behalten die Rechte des Systemkontos und laufen ohne Sandbox.

Die Steuerelemente unter Läufe ändern keine Befehlsberechtigungen. Stoppen beendet den Prozessbaum; der Agent sieht dies beim nächsten Lesen der Ausgabe.
