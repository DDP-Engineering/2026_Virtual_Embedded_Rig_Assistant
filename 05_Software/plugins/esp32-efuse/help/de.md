# ESP32-eFuses und Image-Sicherheit

ESP32-eFuses und Image-Sicherheit ermöglicht dem Agenten, die eFuses eines Espressif-Chips zu prüfen und, nur wenn Sie es ausdrücklich verlangen, jeweils eine dauerhafte eFuse-Änderung vorzunehmen. Es liest eFuse-Zusammenfassungen und Rohwerte mit espefuse und bereitet mit espsecure lokale Secure-Boot-Schlüssel, Signaturen, Digests und verschlüsselte Images vor. eFuse-Bits sind einmal programmierbar: Ein Brennvorgang lässt sich nie rückgängig machen und kann den Chip unbrauchbar machen. Aktivieren Sie das Plugin für eine Workbench nur bei Bedarf; im ESP32-Paket ist seine Gruppe **Security (irreversible)** standardmäßig ausgeschaltet.

## Voraussetzungen

- **espefuse** und **espsecure** aus dem Paket esptool 5 auf PyPI, die **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert. Bei der Installation wird nichts gebrannt.
- Ein Board der ESP32-Familie an einem seriellen Port für Lese- und Brennvorgänge. Virtuelle eFuses (`--virt`) brauchen keinen Chip.
- Keine benötigten Plugins und keine Konfigurationsparameter.

## Verwendung

- „Zeigen Sie die eFuse-Zusammenfassung des ESP32-S3 an COM5.“ (Skill `esp32-efuse-review`)
- „Sind Secure Boot oder Flash-Verschlüsselung auf diesem Chip aktiviert?“
- „Erklären Sie, was das Brennen von JTAG_DISABLE auf diesem ESP32 bewirken würde, und schreiben Sie einen Plan dafür.“
- „Erzeugen Sie einen Secure-Boot-Signaturschlüssel und signieren Sie build/app.bin.“
- „Probieren Sie das Brennen von JTAG_DISABLE zuerst mit virtuellen eFuses aus.“

Eine Frage zu Secure Boot, eine Untersuchung oder das Aktivieren des Plugins gilt nie als Aufforderung zum Brennen. Vor jedem Brennvorgang liest der Agent die aktuelle Zusammenfassung, erklärt das genaue Feld, seinen aktuellen und beabsichtigten Wert und wie ein falscher Wert diesen Chip unbrauchbar machen könnte, und speichert einen schriftlichen Plan als Sitzungsartefakt zu Ihrer Prüfung. Er fasst nie mehrere Brennvorgänge in einem Befehl zusammen, wiederholt nie einen fehlgeschlagenen Brennvorgang und fügt nie `--force` hinzu. Privates Schlüsselmaterial bleibt aus Chat und Artefakten heraus.

## Risiko und Freigaben

- Sicher, läuft ohne Rückfrage: Hilfe und espsecure-Operationen auf lokalen Schlüssel- und Image-Dateien. Sicher beschreibt nur das Hardwarerisiko: espsecure kann Ausgabedateien überschreiben, und `sign-data` ändert seine Eingabedatei, wenn keine Ausgabe angegeben ist.
- Gerät lesen: Zusammenfassung, Dump, Fehlerprüfungen, benutzerdefinierte MAC und ADC-Informationen. Beim Verbinden wird der Chip in seinen Bootloader zurückgesetzt.
- Irreversibel: jeder `burn-*`-Befehl, Schreib- und Leseschutz sowie das Setzen der Flash-Spannung. In den Modi Nachfragen und Auto-Edit fordert VERA Sie auf, das Befehlswort einzugeben, zum Beispiel `burn-efuse`. Im Bypass laufen diese Befehle ohne Rückfrage; verwenden Sie Bypass also mit Vorsicht, wenn dieses Plugin aktiviert ist.
- Gesperrt: espsecure-Operationen mit einem externen HSM.

## Grenzen

- Windows x64 und Linux x64.
- Alle getesteten Brennvorgänge verwendeten virtuelle eFuses; kein physischer Brennvorgang wurde getestet.
- Ein Chip, dessen Codierungsschema das gemeinsame Brennen mehrerer Felder erfordert, wird nicht unterstützt; der Agent hält an und erklärt es.
- Referenzen: https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/index.html und https://docs.espressif.com/projects/esptool/en/latest/esp32/espsecure/index.html
