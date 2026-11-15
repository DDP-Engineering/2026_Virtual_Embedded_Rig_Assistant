# KiCad-PCB-Platzierung und lokales Routing

KiCad-PCB-Platzierung und lokales Routing ermöglicht dem Agenten, kontrollierte Änderungen an einer KiCad-10-Platine auf einer Kandidatenkopie vorzunehmen, über die offizielle IPC-API von KiCad. Er verschiebt, dreht und richtet Footprints aus und fügt Sperrflächen sowie lokale Leiterbahnen und Vias hinzu. Jede Anfrage wird zuerst geprüft (gesperrte Elemente, Netze, Lagen, die Kontur), dann wird der Kandidat mit DRC und auf nicht verbundene Elemente geprüft und mit Vorher-Nachher-Vorschauen gemeldet. Ihre Platine ändert sich nur, wenn Sie verlangen, einen bestandenen Kandidaten zu übernehmen. Laufordner landen in der Workbench unter `electronics-results/<run-id>/`.

## Voraussetzungen

- **KiCad 10**, das Sie selbst von https://www.kicad.org/download/ installieren (unter Ubuntu aus dem KiCad-10-PPA). Verwenden Sie dann **Abhängigkeiten prüfen** auf der Plugin-Seite.
- Die API von KiCad aktiviert: Aktivieren Sie in KiCad unter **Preferences > Plugins** den API-Server.
- **kicad-layout-tool**: ein Skript im Plugin mit seinem API-Client, das **Abhängigkeiten installieren** automatisch installiert.
- Nur ein KiCad-Fenster, das die API hält: Schließen Sie andere KiCad-Fenster, bevor Sie einen Kandidaten öffnen. Der Kandidat öffnet sich in einem eigenen Fenster des PCB-Editors; lassen Sie dieses Fenster in Ruhe, während der Agent arbeitet.
- Keine benötigten Plugins und keine Konfigurationsparameter.

## Verwendung

- „Öffnen Sie einen Kandidaten von boards/sensor.kicad_pcb.“ (Skill `kicad-layout`)
- „Verschieben Sie C3 neben den VCC-Pin von U1 und drehen Sie ihn um 90 Grad.“
- „Fügen Sie eine 0,25-mm-VCC-Leiterbahn von C3 zu U1 und daneben ein GND-Via hinzu.“
- „Halten Sie den Bereich unter der Antenne frei von Leiterbahnen und Vias.“
- „Zeigen Sie mir den Bericht und die Vorschauen und übernehmen Sie dann den Kandidaten in die Platine.“

Eine abgelehnte Anfrage ändert nichts. Der Agent entsperrt Bauteile nie von sich aus; er fragt Sie.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Öffnen, Bearbeiten und Schließen eines Kandidaten. Diese Vorgänge arbeiten nur auf der Kopie im Laufordner und schreiben nie Ihre Platine.
- Gesperrt: andere `kicad-cli`-Befehle, weil `kicad-cli` Dateien im gelesenen Projektordner neu schreibt.
- Übernehmen eines Kandidaten: VERAs `apply_candidate` schreibt einen Kandidaten, dessen Ziele erfüllt sind, über die Quellplatine, mit derselben Freigabe wie jedes Schreiben einer Datei: in Nur lesen abgelehnt, im Modus Nachfragen erfragt. Es wird abgelehnt, wenn sich die Quelle oder der Kandidat geändert hat oder solange die Platine in KiCad geöffnet ist; speichern oder verwerfen Sie dort Ihre Änderungen und schließen Sie sie zuerst.

## Grenzen

- Windows x64 und Linux x64. Natives Ubuntu ist für diese Version noch nicht geprüft.
- Die API von KiCad 10 braucht ein Fenster des PCB-Editors; es gibt keinen Headless-Modus.
- Die DRC von KiCad belegt weder Signalintegrität noch HF-Verhalten oder thermische Eignung.
- Keine globale Platzierung, kein Autorouting, keine Schaltplanbearbeitung und kein Austausch von Footprints. Für Autorouting verwenden Sie das Plugin freerouting.
- Referenz: https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/
