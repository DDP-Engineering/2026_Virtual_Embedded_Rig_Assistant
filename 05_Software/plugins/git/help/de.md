# Git

Git ermöglicht dem Agenten, das Git-Repository der Workbench zu untersuchen und zu ändern. Status, Verlauf, Diffs, Blame sowie die Listen von Branches, Tags, Remotes und Stashes liest er frei; Staging, Commits, Arbeit mit Branches und der Kontakt zu Remotes warten auf Ihre Freigabe. Interaktive Editoren, Pager und Hooks sind ausgeschaltet, sodass jeder Befehl ohne Eingabeaufforderung läuft.

## Voraussetzungen

- **Git 2.40 oder neuer**, das Sie selbst installieren (Git for Windows oder das git-Paket Ihrer Distribution). VERA findet es im PATH, in den Standardordnern von Git for Windows oder unter `/usr/bin/git` und lädt es nie herunter. Verwenden Sie nach der Installation **Abhängigkeiten prüfen** auf der Plugin-Seite.
- Für fetch, pull, push und clone: Ihre eigenen eingerichteten Zugangsdaten oder SSH-Schlüssel. VERA fügt keine Zugangsdaten hinzu, und Git fragt nicht danach.
- Keine benötigten Plugins, keine Hardware und keine Konfigurationsparameter.

## Verwendung

- „Was hat sich seit dem letzten Release-Tag geändert?“ (Skill `git-inspect`)
- „Wer hat die Zeilen 40 bis 60 von src/main.c zuletzt geändert?“
- „Committen Sie die Änderungen an src/uart.c und src/uart.h mit der Nachricht 'Fix UART overrun handling'.“ (Skill `git-commit`)
- „Erstellen Sie aus main einen Branch feature/adc-calibration und wechseln Sie dorthin.“ (Skill `git-branches`)
- „Mergen Sie feature/adc-calibration in main.“
- „Klonen Sie das SDK-Repository nach sdk/ und holen Sie seine Submodule.“ (Skill `git-sync`)
- „In v1.2.0 hat es funktioniert, jetzt liest der ADC null. Finden Sie den Commit, der es kaputt gemacht hat.“ (Skill `git-bisect`)
- „Aus welcher Revision stammt dieser Build, und was hat sich seit dem letzten Release geändert?“ (Skill `git-release`)

Der Agent staget nur die Pfade, denen Sie zugestimmt haben, schreibt die Nachricht mit `commit -m` und nennt den entstandenen Commit-Hash. Er pusht nur, wenn Sie es verlangen, schreibt nie bereits gepushten Verlauf um und meldet Ihnen Merge- oder Rebase-Konflikte, statt Änderungen zu verwerfen.

## Risiko und Freigaben

Die Risikostufen werden für den Zustand des Repositorys wiederverwendet:

- Sicher, läuft ohne Rückfrage: status, log, diff, show, blame, describe, grep und die anderen Lesebefehle das Auflisten von Branches, Tags, Remotes, Stashes, Worktrees und Submodulen sowie das Lesen eines Konfigurationsschlüssels.
- Gerät schreiben: Befehle, die gespeicherten Zustand ändern oder ein Remote kontaktieren, etwa add, commit, switch, merge, rebase, reset, fetch, pull, clone und push, das Anlegen eines Branches mit `checkout -b`, das Entfernen aus dem Staging mit `restore --staged`, die Schritte eines Bisect, das Setzen von `user.name` oder `user.email` sowie jeder Befehl, der Ausgabe in eine Datei schreibt. Die Modi Nachfragen und Auto-Edit fragen vor jedem dieser Befehle nach.
- Irreversibel: Befehle, die Arbeit verwerfen oder Verlauf umschreiben können, etwa checkout eines Branches oder Pfads, restore einer Datei, clean, ein Hard Reset, das Löschen eines Stashs sowie Force- oder Lösch-Pushes. VERA fordert Sie auf, den Namen des Befehls einzugeben, außer im Bypass.
- In jedem Modus gesperrt: andere Konfigurationsänderungen, ausführbare Aliase und unbekannte Befehlsnamen, interaktive Befehle, `bisect run` und das explizite Ausführen von Programmen.

## Grenzen

- Windows x64, Linux x64 und Linux arm64.
- Ein Clone, Fetch, Pull, Push oder Submodul-Update darf 30 Minuten laufen; eine HTTP-Übertragung, die nicht mehr vorankommt, wird nach einer Minute beendet. Jeder andere Befehl hat eine Minute.
- Git läuft nicht in einer Sandbox: Inhaltsfilter wie LFS und repository-lokale textconv- oder Filtertreiber können weiterhin Programme ausführen. Gehen Sie mit einem nicht vertrauenswürdigen Repository vorsichtig um.
- Git-Änderungen erscheinen nicht im Bereich Änderungen von VERA; das Laufprotokoll zeichnet jeden Befehl und seine Ausgabe auf.
