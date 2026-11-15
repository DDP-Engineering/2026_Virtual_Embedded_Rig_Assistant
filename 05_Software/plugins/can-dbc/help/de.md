# CAN-Datenbanken (cantools)

CAN-Datenbanken macht aus erfasstem CAN-Verkehr benannte Signale mit Einheiten. Der Agent dekodiert ASC-, BLF- und candump-Logdateien mit einer DBC-, KCD-, SYM- oder ARXML-Datenbank und kann mit cantools Datenbanken ausgeben, auflisten oder konvertieren und C-Quellcode daraus erzeugen. Es liest nur Dateien; es öffnet nie einen Bus. Zum Erfassen von Verkehr verwenden Sie das Plugin can-python.

## Voraussetzungen

- **cantools** 45 von PyPI und **can-decode**, ein Skript im Plugin: beide werden von **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Eine CAN-Datenbank und eine erfasste Logdatei in der Workbench.
- Keine benötigten Plugins, keine Hardware und keine Konfiguration.

## Verwendung

- „Listen Sie die Botschaften und Signale in fixtures/board.dbc auf.“
- „Dekodieren Sie captures/bus.asc mit fixtures/board.dbc und fassen Sie die Signale zusammen.“ (Skill `can-decode`)
- „Zeigen Sie nur die Botschaften 0x100 und 0x200 aus den ersten 200 Frames.“
- „Konvertieren Sie board.dbc nach KCD.“
- „Erzeugen Sie C-Quellcode für board.dbc.“

Jede dekodierte Zeile zeigt Zeit, ID, Botschaft und Signalwerte mit Einheiten, gefolgt von einer Zusammenfassung der dekodierten Frames pro Botschaft, der nicht dekodierbaren Frames und der IDs, die die Datenbank nicht definiert. Der Agent meldet unbekannte IDs als Verkehr, den die Datenbank nicht beschreibt, nicht als Fehler, und nennt zu jedem Befund die Aufzeichnung, die Datenbank und die Frame-Zeiten. Lange Aufzeichnungen werden über Botschafts-ID und Frame-Limit eingegrenzt.

## Risiko und Freigaben

Jeder Befehl, den dieses Plugin erlaubt, ist sicher und läuft ohne Rückfrage: Dekodieren, Ausgeben und Auflisten lesen nur ihre Eingaben; Konvertieren und das Erzeugen von C-Quellcode schreiben ihre Ausgabedateien wie andere Analyseausgaben. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

Drei cantools-Befehle sind gesperrt: `decode` und `plot` lesen Frames von der Standardeingabe, die VERA schließt, und `monitor` ist eine interaktive Terminalansicht, die einen Bus öffnet. Der Agent verwendet stattdessen `can-decode`.

## Grenzen

- Windows x64 und Linux x64.
- Eine Datenbank, die die Konsistenzprüfungen von cantools nicht besteht, kann auf Anfrage trotzdem geladen werden (`--no-strict`); der Agent sagt, wenn er das getan hat.
- Referenz: https://cantools.readthedocs.io/en/latest/
