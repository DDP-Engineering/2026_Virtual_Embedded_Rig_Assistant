# Wireshark (TShark)

Mit dem Offline-Werkzeug Felder auswählen, Pakete filtern und Frames aus einem geprüften Mitschnitt belegen. Beim Import bleibt die geprüfte Datei im Arbeitsbereich erhalten.

Dieses Plugin ermöglicht dem Agenten, Netzwerk-Aufzeichnungsdateien mit TShark zu analysieren und Live-Verkehr von einer Schnittstelle Ihres Computers aufzuzeichnen. Es beantwortet Fragen zu `.pcap`- und `.pcapng`-Aufzeichnungen des Ethernet-, WLAN- oder USB-Verkehrs eines Boards mit Anzeigefiltern, Feldexport, Protokollstatistiken und Paketdetails und speichert begrenzte Live-Aufzeichnungen in der Workbench.

## Voraussetzungen

- **TShark**, das Sie selbst mit Wireshark von https://www.wireshark.org/download.html installieren (unter Windows enthält es TShark und bietet Npcap an), oder das Paket `tshark` Ihrer Distribution (`sudo apt install tshark` unter Debian und Ubuntu). VERA lädt es nie herunter; der Abschnitt **Abhängigkeiten** der Plugin-Seite zeigt, ob es gefunden wurde.
- Für Live-Aufzeichnungen: Npcap unter Windows oder Aufzeichnungsberechtigungen für dumpcap unter Linux (installieren Sie `wireshark-common`, erlauben Sie Aufzeichnungen ohne root, treten Sie der Gruppe `wireshark` bei und melden Sie sich erneut an). VERA überlässt diese Schritte Ihnen.
- Keine anderen Plugins und keine Konfiguration.

## Verwendung

Der Agent verwendet die Skills `wireshark-analyze` und `wireshark-capture`. Er liest Dateien immer mit `-r` und hält Adressen numerisch, sodass keine Namensauflösung das Netzwerk erreicht. Für eine Live-Aufzeichnung listet er die Schnittstellen auf und lässt Sie bestätigen, welche den Verkehr des Boards führt.

- „Geben Sie mir eine Protokollübersicht von captures/board.pcapng.“
- „Listen Sie jede CoAP-Anfrage in der Aufzeichnung mit ihrer Zeit und ihrem URI-Pfad auf.“
- „Zeigen Sie die TCP-Probleme, die die Expertenanalyse meldet, mit Frame-Nummern.“
- „Dekodieren Sie UDP-Port 5684 als CoAP und exportieren Sie die Codes.“
- „Zeichnen Sie 30 Sekunden Verkehr von und zu 192.168.7.10 an Schnittstelle 3 in captures/board.pcapng auf.“

## Risiko und Freigaben

- **Sicher** (läuft ohne Rückfrage): Lesen einer gespeicherten Aufzeichnung mit beliebigen Filter-, Feld-, Statistik- oder Ausgabeoptionen, Hilfe, Version und Auflisten der Schnittstellen.
- **Gerät lesen** (fragt im Modus **Nachfragen** nach, läuft in **Auto-Edit** selbstständig): eine Live-Aufzeichnung und jeder Befehl, der eine Datei oder einen Ordner schreibt (`-w`, `--export-objects`, `--export-tls-session-keys`, `--log-file`), etwa eine gefilterte Kopie einer Aufzeichnung. Ein Befehl ohne `-r` zeichnet ebenfalls live auf, an der ersten Schnittstelle.
- **Gerät schreiben** (fragt in **Nachfragen** und **Auto-Edit** nach): eine Option, die dieses Plugin nicht erkennt.
- **Gesperrt**: Lua-Skripte, die beliebigen Code ausführen können, und RPCAP-Passwörter auf der Befehlszeile, die in Laufprotokollen gespeichert würden.

## Grenzen

- Windows x64 und Linux x64. Die Regeln wurden an TShark 4.6.8 ermittelt.
- Die Offline-Analyse verwendet ein isoliertes Wireshark-Profil. Allgemeine TShark-Aufrufe verwenden Ihr Wireshark-Profil und dessen Erweiterungen.
- Remote- und extcap-Schnittstellen (sshdump, `rpcap://`) zeichnen auf anderen Hosts auf. Richten Sie Remote-Aufzeichnung und ihre Zugangsdaten außerhalb von VERA ein.
