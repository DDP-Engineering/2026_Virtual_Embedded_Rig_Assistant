# QElectroTech-Schaltpläne

QElectroTech-Schaltpläne lässt den Agenten Ihre QElectroTech-Projekte (.qet) lesen und neben dem elektrischen Projektmodell damit arbeiten. Er listet Blätter, Geräte mit ihren verknüpften Kontakten und Querverweisen sowie die durch Leiter verbundenen Potenziale auf und ordnet die Geräte den Kennzeichen des Modells zu. Für einen Motor mit einem aktuellen Ergebnis der Motoranlauf-Auslegung entwirft er aus der Vorlage Direktstart, Wendestarter oder Stern-Dreieck einen zweiblättrigen Plan (Haupt- und Steuerstromkreis) und prüft ihn vor Ihrer Freigabe. Außerdem benennt er Elemente in einem bestehenden Projekt um und speichert eine Prüfung von Nummerierung, Querverweisen und Geräteliste.

## Was es braucht

- **Kein Programm.** Der Agent nutzt die eingebauten VERA-Werkzeuge `qelectrotech`, `qelectrotech_change` und `qelectrotech_check`, die nur angeboten werden, solange dieses Plugin aktiviert ist. Es gibt nichts zu installieren oder herunterzuladen, daher hat **Install dependencies** hier nichts zu tun.
- QElectroTech selbst (getestet mit 0.100 unter Windows und 0.90 unter Ubuntu), um die Projekte zu öffnen, zu prüfen, zu nummerieren und zu speichern. VERA startet es nie: QElectroTech hat keinen Export über die Befehlszeile.
- Für einen Kandidaten: ein aktuelles Ergebnis der Motoranlauf-Auslegung (Plugin Motoranlauf und Antriebe) mit der Methode Direktstart, Wendestarter oder Stern-Dreieck.

## So verwenden Sie es

- „Lies schematics/plant.qet und liste die Blätter und eventuelle Probleme auf.“ (Skill `qelectrotech-schematics`)
- „Welche Kontakte gehören zu KM1, und auf welchem Blatt und in welcher Spalte sind sie?“
- „Entwirf den Stern-Dreieck-Plan für Pumpe M2 aus dem letzten Motorergebnis.“
- „Benenne KM1 im eben gespeicherten Projekt in KM10 um.“
- „Prüfe Nummerierung und Querverweise und vergleiche die Geräteliste mit dem Modell.“
- „Trage die QElectroTech-Geräte ins Elektromodell ein.“

Kandidaten sind neue Dateien. Ein Prüfergebnis wird mit dem Hash der Projektdatei in `electrical-automation-results/<run-id>/` gespeichert; ändert sich das Modell, wird es als veraltet markiert.

## Risiko und Freigaben

`qelectrotech` liest nur. `qelectrotech_change` und `qelectrotech_check` sind Schreibwerkzeuge: Sie fragen wie ein Dateischreibvorgang nach Ihrer Freigabe und werden in Read-only-Sitzungen nicht angeboten. Ein Kandidat wird nie über eine bestehende Datei geschrieben; eine Änderung nennt den Hash der gelesenen Datei und schlägt fehl, wenn sich die Datei inzwischen geändert hat, sodass nichts überschrieben wird, was Sie in QElectroTech gespeichert haben. Nur die geänderten Texte ändern sich; alle übrigen Bytes bleiben. Das Elektromodell wird nur über das Modellwerkzeug mit Ihrer Freigabe geändert. Es gibt keine device-read-, device-write- oder irreversiblen Aktionen.

## Grenzen

- Geprüft unter Windows x64 und WSL2; noch nicht unter nativem Ubuntu x64 ausgeführt.
- Dateien mit einer Dokumenttypdeklaration oder Entitäten werden abgelehnt (Schutz vor externen XML-Entitäten).
- Eine elektrische Verriegelung zählt nur als Öffner in jedem Pfad zur Spule; eine mechanische Verriegelung stammt aus dem Motoranlauf-Ergebnis, nie aus der Zeichnung. Vorlagen für Sanftanlasser und Umrichter gehören nicht zu dieser Version.
- Steuerspannung, Taster und Zeitrelais der Vorlagen sind Vorschläge, die Sie bestätigen. Die Leiternummerierung bleibt offen, bis Sie die Leiter in QElectroTech nummerieren.
- Kein PDF und kein Bild wird in einen Schaltplan umgewandelt.
- Ergebnisse sind vorläufige Ingenieurunterstützung: keine geprüfte Auslegung, keine Konformitätserklärung, und es wird keine Sicherheitsfunktion beansprucht.
