# CAN-Bus (python-can)

CAN-Bus ermöglicht dem Agenten, über python-can CAN-Adapter zu finden, einen Bus im Listen-only-Modus in ein ASC-, BLF- oder candump-Log aufzuzeichnen und einzelne Frames zu senden oder ein Log auf einem aktiven Bus wiederzugeben. Unterstützte Schnittstellen sind PEAK, Vector, Kvaser, slcan, gs_usb (candleLight) und SocketCAN sowie ein Software-Bus (`udp_multicast`) zum Proben ohne Hardware. Dekodieren Sie die Aufzeichnungen mit dem Plugin can-dbc.

## Voraussetzungen

- **can**: ein Skript auf Basis von python-can 4.6.1, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Ein CAN-Adapter und sein Herstellertreiber, den Sie selbst installieren; VERA installiert nie Treiber. `can list` meldet jeden fehlenden mit einem Hinweis: den PEAK-Treiber mit PCAN-Basic, das Vector-Treibersetup und die XL Driver Library (Windows), die Kvaser-Treiber und CANlib, WinUSB über Zadig für gs_usb unter Windows.
- Unter Linux bringen Sie eine SocketCAN-Verbindung selbst hoch, zum Beispiel im Listen-only-Modus mit der richtigen Bitrate, oder legen einen virtuellen Bus `vcan0` an.
- Schnittstelle, Kanal und Bitrate Ihres Busses. Der Agent rät nie eine Bitrate.
- Keine Konfigurationsparameter.

## Verwendung

- „Welche CAN-Schnittstellen und Treiber sind verfügbar?“
- „Zeichnen Sie 10 Sekunden des Busses an PCAN_USBBUS1 mit 500 kbit/s in captures/bus.asc auf.“ (Skill `can-capture`)
- „Zeichnen Sie im Hintergrund 2000 Frames von can0 in captures/can0.blf auf.“
- „Senden Sie die ID 0x200 mit den Daten E80301 an PCAN_USBBUS1 mit 500 kbit/s.“ (Skill `can-transmit`)
- „Geben Sie die ersten 50 Frames von captures/startup.asc wieder und zeichnen Sie dabei die Antwort auf.“

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Auflisten von Schnittstellen und Treibern.
- Gerät lesen: eine Aufzeichnung im Listen-only-Modus. PEAK-, Vector-, Kvaser- und slcan-Adapter werden so geöffnet, dass sie nie Frames bestätigen; eine SocketCAN-Verbindung zählt nur, wenn Sie sie im Listen-only-Modus hochgebracht haben.
- Gerät schreiben: eine Aufzeichnung mit `--active`, bei der der Adapter dem Bus beitritt und Frames bestätigt; eine falsche Bitrate kann Error-Frames auslösen, die andere Knoten stören. Der Agent fragt Sie, bevor er die Option hinzufügt.
- Irreversibel: `send` und `replay`, die auf einem aktiven Bus senden; empfangende Steuergeräte reagieren sofort auf die Frames. VERA fordert Sie auf, zur Bestätigung `send` oder `replay` einzugeben, außer im Bypass.

Im Modus Nachfragen fragt VERA vor jeder Aufzeichnung nach; Auto-Edit führt Aufzeichnungen im Listen-only-Modus ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64.
- Echte Adapter und Linux-`vcan0` werden von VERAs Tests noch nicht abgedeckt; der Listen-only-Modus wird beim Backend angefordert und nicht vom Adapter zurückgelesen.
- Eine nur durch eine Frame-Anzahl begrenzte Aufzeichnung endet spätestens nach 240 Sekunden; für eine längere Aufzeichnung eine Dauer angeben.
- Eine `.blf`-Aufzeichnung, die vor Ablauf ihrer Dauer gestoppt wird, kann unvollständig sein; `.asc` und `.log` werden Frame für Frame geschrieben.
- Buseinstellungen kommen nur von der Befehlszeile; `~/.canrc`, `can.ini` und `CAN_*`-Variablen werden ignoriert.
- Referenz: https://python-can.readthedocs.io/en/v4.6.1/
