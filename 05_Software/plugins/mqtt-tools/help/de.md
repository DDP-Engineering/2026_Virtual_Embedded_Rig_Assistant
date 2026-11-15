# MQTT-Werkzeuge (Telemetrie und Befehle)

Dieses Plugin ermöglicht dem Agenten, MQTT-Telemetrie aufzuzeichnen und kontrollierte Gerätebefehle über einen Broker zu senden, den Ihre Workbench konfiguriert. Aufzeichnungen sind nach Zeit, Nachrichtenanzahl und Bytes begrenzt und behalten jede Rohnutzlast mit ihren Flags. Eine Nachricht geht nur an ein Topic, das das Broker-Profil deklariert, wird einmal gesendet und nie wiederholt, und ein Befehl wird nie als Retained gespeichert. MQTT 5 und 3.1.1 werden unterstützt; es gibt keine Broker-Administration. Die Ergebnisse landen unter `arduino-iot-results/`.

## Voraussetzungen

- **mqtt-tool**, ein auf paho-mqtt 2.1.0 festgelegtes Python-Skript im Plugin, das VERA mit **Abhängigkeiten installieren** selbst installiert.
- Ein **Broker-Profil**: eine JSON-Datei in der Workbench, die den Broker, das TLS-Vertrauen, die Referenz der Zugangsdaten, das Protokoll, die Topics, die eine Aufzeichnung abonnieren und ein Lauf veröffentlichen darf, Grenzwerte, Nutzlastschemata und einen optionalen Status-Last-Will deklariert.
- Die **Broker-Zugangsdaten** (`broker-credential`): Benutzername und Passwort, gespeichert unter der Referenz, die das Profil nennt, zum Beispiel `bench`. Legen Sie sie im Abschnitt **Konfiguration** der Plugin-Seite fest. Sie bleiben im Zugangsdatenspeicher von VERA und erreichen nur einen freigegebenen Lauf dieses Plugins; fügen Sie sie nie in den Chat ein.

## Verwendung

Der Agent verwendet die Skills `mqtt-telemetry` und `mqtt-commands`.

- „Prüfen Sie das Broker-Profil mqtt/bench.json und testen Sie die Verbindung mit den Zugangsdaten bench.“
- „Zeichnen Sie vera-test/bench1/telemetry/# 30 Sekunden lang auf und zählen Sie die neuen Nachrichten.“
- „Veröffentlichen Sie online im Status-Topic vera-test/bench1/status/vera.“
- „Senden Sie den LED-Befehl {"on":true} und warten Sie auf die Antwort des Geräts.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Beschreiben des Clients und Offline-Prüfung eines Profils.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): ein Verbindungstest und eine begrenzte Aufzeichnung. Nichts wird veröffentlicht, außer dem Status-Last-Will, falls die Verbindung abnormal endet.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): Veröffentlichen einer Nachricht oder Senden einer Anfrage; ein Befehl kann ein Gerät zum Handeln bringen. Stoppen kann eine gesendete Nachricht nicht zurücknehmen.
- **Irreversibel** (fragt nach, und Sie geben das auf der Karte angezeigte Bestätigungswort ein): Veröffentlichen einer Retained-Nachricht, die der Broker behält und an jeden späteren Abonnenten ausliefert, bis sie ersetzt wird. In **Bypass — voller Zugriff** läuft dies ohne Rückfrage.

Bevor Sie einen Lauf freigeben, der Zugangsdaten nennt, prüfen Sie den Broker-Host im Profil: Die Zugangsdaten gehen an diesen Broker.

## Grenzen

- Windows x64 und Linux x64.
- QoS 2 wird nicht unterstützt. Eine QoS-1-Nachricht kann das Gerät durch erneute Zustellung des Brokers zweimal erreichen.
- Bricht die Verbindung vor der Bestätigung ab, wird die Zustellung als unbekannt gemeldet.
- Das Plugin ist noch nicht gegen einen Produktiv-Broker oder ein echtes Gerät gelaufen.
