# Serial Monitor

Dieses Plugin ermöglicht dem Agenten, die seriellen Ports Ihres Computers mit ihren USB-IDs, Seriennummern und ihrer Board-Familie aufzulisten, die Konsole eines Boards aufzuzeichnen (optional nach einem Reset über DTR/RTS) und dem Board eine Zeile oder einige Bytes zu senden. Verwenden Sie es, um herauszufinden, welchen Port ein Board verwendet, und um sein Boot-Log oder seine Konsolenausgabe zu lesen.

## Voraussetzungen

- **serial**, ein Python-Skript im Plugin auf Basis von pyserial 3.5, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- Ein über USB-Seriell angeschlossenes Board.
- Unter Linux muss Ihr Benutzer in der Gruppe sein, der die seriellen Ports gehören: `dialout` (Debian, Ubuntu, Fedora) oder `uucp` (Arch). Der Agent zeigt den Befehl, aber Sie führen ihn selbst aus und melden sich erneut an.
- Keine anderen Plugins und keine Konfiguration. Zum Bestätigen eines ESP32-Chiptyps hilft das Plugin esp32-esptool.

## Verwendung

Der Agent verwendet die Skills `serial-console`, `board-identify` und `esp32-identify`. Er listet die Ports auf, bevor er einen verwendet, und rät nie einen Portnamen; unter Linux bevorzugt er den stabilen Pfad `/dev/serial/by-id/...`.

- „Welche Boards sind angeschlossen, und an welchen Ports?“
- „Zeichnen Sie 10 Sekunden lang die Konsole des Boards an COM5 auf.“
- „Setzen Sie den ESP32 an COM7 zurück und zeichnen Sie das Boot-Log auf, bis app_main aufgerufen wird.“
- „Senden Sie help an das Board an COM5 und zeigen Sie die Antwort.“
- „Verfolgen Sie die Konsole des Boards an /dev/ttyUSB0 im Hintergrund, bis ich Stopp sage.“
- „Zeichnen Sie das Boot-Log des Boards an COM7 mit Zeitstempeln auf und sagen Sie mir, wie lange der Start dauert.“
- „Senden Sie die Bytes 01 03 00 00 00 0A C5 CD an den Zähler an COM9 mit 19200 Baud, 8E1, und zeigen Sie die Antwort.“
- „Lesen Sie die Konsole des simulierten Boards unter socket://localhost:5555.“
- „Ich kenne die Baudrate des Boards an COM5 nicht: Finden Sie sie und zeigen Sie die Konsole.“
- „Senden Sie version, während Sie die Konsole des Boards an COM5 verfolgen, und zeigen Sie die Antwort.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Auflisten von Ports, Hilfe und Version.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): Aufzeichnen der Konsole. Das bloße Öffnen des Ports startet das Board nicht neu; mit einem Reset startet es über DTR/RTS neu.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Senden einer Zeile oder von Bytes. Die Firmware des Boards entscheidet, was die Zeile bewirkt, daher sendet der Agent nur, was Sie verlangt haben.

Solange eine Aufzeichnung im Hintergrund einen Port belegt, lehnt VERA jeden anderen Lauf auf diesem Port ab, bis die Aufzeichnung gestoppt ist. Um dem Board währenddessen etwas zu senden, sendet der Agent über diese Aufzeichnung, statt den Port erneut zu öffnen.

## Grenzen

- Windows x64 und Linux x64.
- Eine Aufzeichnung im Vordergrund läuft höchstens eine Stunde; längere laufen im Hintergrund, bis Sie sie beenden.
- Das Terminal oder der Socket eines Simulators (`/dev/pts/N`, `socket://host:port`, `rfc2217://host:port`) funktioniert als Port. Dort gibt es keine Reset-Leitungen; starten Sie die Simulation neu, um ein Boot-Log zu sehen.
- „Zugriff verweigert“ unter Windows bedeutet, dass ein anderes Programm, etwa ein Terminal oder der Monitor einer IDE, den Port belegt.
- Ein Port ohne erkannte Familie ist nicht unbedingt das erwartete Board; der Agent fragt, bevor er ihn verwendet.
- Konsolenausgabe wird als Daten vom Gerät behandelt, nie als Anweisungen.
