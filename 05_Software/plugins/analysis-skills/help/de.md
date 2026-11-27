# Firmware-Analyse und Testplanung

Analyse-Skills gibt dem Agenten zwei Verfahren für die Arbeit mit bereits erfassten Belegen. Der Skill `firmware-comparator` vergleicht einen Referenz- und einen Kandidatenlauf einer Firmware anhand ihrer Logs, der dokumentierten Laufbedingungen, der Release Notes und eines Abnahmekriteriums und speichert einen Vergleichsbericht mit Quellenangaben in der Sitzung. Der Skill `test-planner` macht aus einer Firmware-Änderung, einem erfassten Fehler oder einem Ziel einen bis fünf manuelle Testfälle mit belegtem Aufbau, Schritten, Abnahmekriterien und einer Ergebnistabelle und speichert den Plan in der Sitzung. Keiner der beiden Skills flasht, erfasst, baut oder führt einen Test aus.

## Voraussetzungen

- Keine Programme und keine Konfiguration: Das Plugin fügt nur Skills hinzu.
- Erfasste Logs in der Workbench (zum Beispiel unter `logs/`), Laufnotizen wie `docs/runs.md` oder `WORKBENCH.md` sowie die Dokumente mit Kriterien und Release Notes, die der Vergleich oder Plan zitieren soll. Indexierte Dokumente machen Release Notes durchsuchbar; ohne Indexierung liest der Agent die Dateien direkt.
- Optional: Um zwei Builds nach Größe oder Symbolen zu vergleichen, beide Build-Ordner und ein aktiviertes Plugin mit einem sicheren Größen- oder Symbolbefehl, zum Beispiel esp32-idf (`idf.py size`).

## Verwendung

- „Vergleichen Sie die Boot-Logs von Firmware 1.0.0 und 1.1.0 auf Board-Revision B mit dem Boot-Kriterium in docs/boot-test.md.“
- „Welche dieser Läufe unterscheiden sich, und was hat sich zwischen ihnen geändert? Fragen Sie mich, wenn mehrere Läufe passen.“
- „Planen Sie bis zu drei manuelle Tests für die Änderung am I2C-Timing in Release 1.1.0.“
- „Machen Sie aus dem Vergleichsbericht einen Testplan mit einer Referenzkontrolle.“

Bitten Sie nach dem erneuten Öffnen des Chats um einen Plan aus dem neuesten gespeicherten Vergleich dieser Sitzung.
Für einen bestimmten Bericht geben Sie seine genaue Referenz `artifact:...` an. Der Plan zeigt den
Status jedes Falls. Bei dokumentiertem Aufbau und fehlendem Abnahmegrenzwert hält der Fall fest,
was zu messen ist, und dient der Beobachtung.
Gespeicherte Zeilenverweise übernehmen den kleinsten vom Werkzeug gelieferten Bereich, der die zitierten Zeilen abdeckt.

Wenn mehrere Läufe passen, bittet der Agent Sie um eine Auswahl; er nimmt nie stillschweigend den neuesten. Fehlen Board, Revision, Aufbau oder Kriterium, bleibt der Bericht oder Plan als blockiert markiert, und der Agent fragt nach den fehlenden Angaben. Ein Zahlengrenzwert, den keine Quelle nennt, wird nie erfunden.

## Risiko und Freigaben

Das Plugin deklariert keine Regeln und führt keine eigenen Programme aus. Ein Testplan kann einen Befehl eines anderen aktivierten Plugins nennen, etwa `esptool write-flash` (Gerät schreiben), aber nur als optionalen Schritt, den Sie separat anfordern können. Der optionale Größenvergleich verwendet nur einen sicheren Befehl des anderen Plugins, der ohne Rückfrage läuft.

## Grenzen

- Windows x64 und Linux x64.
- Ein Vergleich stellt fest, was die Aufzeichnungen zeigen, nicht warum: Übereinstimmende Notizen beweisen nicht, dass der Laboraufbau übereinstimmte, und Vergleichbarkeit ist keine Release-Reife.
- Ein Plan ist nur Vorbereitung; Ergebnisse bleiben ausstehend, bis Sie gemessene Belege liefern.
