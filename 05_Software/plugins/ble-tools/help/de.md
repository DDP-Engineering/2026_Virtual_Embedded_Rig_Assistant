# BLE-Werkzeuge (Erkennung und GATT)

BLE-Werkzeuge ermöglicht dem Agenten, für eine begrenzte Zeit nach Bluetooth-Low-Energy-Geräten zu suchen und kontrollierte GATT-Operationen auf von Ihnen deklarierten Geräten auszuführen: die Identität eines Geräts gegen sein Profil bestätigen, seine Services auflisten, deklarierte Characteristics lesen, Notifications aufzeichnen und einen benannten Schreibvorgang senden. Ein Gerät wird über seine Adresse identifiziert, nie über seinen Namen oder seine Signalstärke. Die Ergebnisse landen in der Workbench unter `arduino-iot-results/<run-id>/`.

## Voraussetzungen

- **ble-tool**: ein auf Bleak 3.1.0 festgelegtes Skript, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Ein eingeschalteter Bluetooth-Adapter an diesem Computer: Windows 11 oder Linux mit BlueZ 5.55 oder neuer.
- `lab/resources.json` in der Workbench (Parameter `lab-resources`): ein Eintrag `ble-device` pro Gerät mit Alias, Adresse, Profil und optional Seriennummer. Der Abschnitt **Konfiguration** der Plugin-Seite zeigt, ob die Datei gültig ist.
- Ein Geräteprofil: eine JSON-Datei, die die Services, Characteristics, Nutzdaten, Einheiten, Grenzwerte, erlaubten Operationen und benannten Schreibvorgänge des Geräts deklariert. Ein Beispiel wird mit dem Plugin geliefert.
- Das Pairing ist, falls nötig, Ihr Schritt in den Bluetooth-Einstellungen des Betriebssystems.

## Verwendung

- „Suchen Sie 10 Sekunden lang nach BLE-Geräten.“ (Skill `ble-devices`)
- „Schreiben Sie ein Profil und einen Eintrag in lab/resources.json für das Thermometer unter C4:7F:51:00:12:34.“ (Skill `ble-profiles`)
- „Identifizieren Sie das Gerät thermo anhand von ble/thermo.json.“
- „Zeichnen Sie 30 Sekunden lang die Temperatur-Notifications von thermo auf.“
- „Setzen Sie die Lüfterstufe des Geräts fan auf 40.“

Der Agent fragt Sie, welche Adresse das Gerät ist; er wählt nie eine anhand eines Namens. Ein fehlgeschlagener Verbindungsaufbau, Lese- oder Schreibvorgang wird nicht wiederholt.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Offline-Prüfung eines Profils und Laufberichte.
- Gerät lesen: Suchen, Identifizieren, Auflisten der Services sowie Lesen oder Abonnieren von Characteristics ohne Nebenwirkungen.
- Gerät schreiben: Lesen oder Abonnieren einer Characteristic, die das Profil als zustandsändernd markiert, Senden eines Konfigurations- oder Stellbefehls (er kann eine Einstellung ändern oder Hardware bewegen, schalten oder ansteuern, und Stoppen macht ihn nicht rückgängig) sowie Freigeben einer Verbindung.
- Irreversibel: ein dauerhafter Schreibvorgang, den das Gerät speichert und über einen Reset hinweg behält. VERA fordert Sie auf, das Bestätigungswort einzugeben, außer im Bypass.

Im Modus Nachfragen fragt VERA vor jedem Befehl der Stufen Gerät lesen und Gerät schreiben nach; Auto-Edit führt Befehle der Stufe Gerät lesen ohne Rückfrage aus.

## Grenzen

- Windows x64 und Linux x64; Windows 10 wird nicht unterstützt. Unter Linux muss eine Suche aktiv sein (`--active`), und ein Schreibvorgang mit Antwort ist auf 20 Bytes begrenzt.
- Kein Pairing, keine PIN-Eingabe, kein Raw-Write, kein Firmware-Update, kein Advertising, kein Bluetooth Classic und keine Änderung von Bluetooth-Einstellungen.
- Geprüft sind nur ein simuliertes Backend und eine echte passive Suche unter Windows 11; Operationen mit echten Geräten und Linux sind noch nicht nachgewiesen.
- Referenz: https://bleak.readthedocs.io/en/latest/
