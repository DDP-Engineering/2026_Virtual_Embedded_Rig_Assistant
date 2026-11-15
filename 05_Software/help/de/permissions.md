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

Bypass zeigt zuerst eine Warnung: Der Agent kann dann Projekte, Dateien oder Anwendungseinstellungen außerhalb der Workbench beschädigen. Die Warnung listet außerdem die Regeln Ihrer aktivierten Plugins auf, die dauerhafte Änderungen vornehmen oder außerhalb des Geräts wirken, denn in Bypass laufen sie ohne Nachfrage. **Diese Meldung beim nächsten Mal nicht mehr anzeigen** blendet die Warnung aus; der gewählte Bypass-Modus bleibt rot markiert.

Auch in Bypass sind nur aktivierte Werkzeuge verfügbar, die Berechtigungen des Betriebssystems gelten, der Agent kann `.vera/workbench.yaml` und `.vera/plugins` nicht ändern, und Befehle von Test-Plugins fragen weiterhin nach.

## Genehmigen oder ablehnen

Braucht der Agent Ihre Entscheidung, erscheint eine Freigabekarte in der Unterhaltung, und die Sitzung zeigt **Wartet auf Freigabe**.

- Bei einer Dateiänderung zeigt die Karte die Datei und einen **Unified Diff** der Änderung.
- Bei einem Download zeigt sie die Quelladresse und die maximale Größe.
- Bei einem Programm zeigt sie die Risikostufe, **Plugin**, **Befehlszeile**, **Arbeitsverzeichnis**, **Programmdatei**, **Hinweise der Regeln** und die Workbench-Dateien, die der Befehl verwendet, mit ihrem SHA-256.

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
