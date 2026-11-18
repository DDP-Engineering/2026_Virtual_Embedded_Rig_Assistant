# Messvalidierung

Messvalidierung vergleicht Laboraufzeichnungen und Simulationen offline und reproduzierbar mit Anforderungen. Der Agent schreibt eine JSON-Anfrage, die Quellen, Signale, Messfenster, Ausrichtung, Kriterien, Entscheidungsregel und Unsicherheit nennt, und das Programm erledigt die Arbeit: Es importiert die Daten, normalisiert Einheiten und Vorzeichen, misst Effektivwert, Frequenz, Tastverhältnis, Anstiegs- und Abfallzeit, Überschwingen, Einschwingen, Welligkeit und Verzögerung, richtet Messreihen über deklarierte Marker oder begrenzte Kreuzkorrelation aus und entscheidet jedes Kriterium als bestanden, nicht bestanden oder unvollständig. Der Bericht mit Überlagerungen, Differenzen, Bedingungen und Verweisen auf die Quellen landet in der Workbench unter `embedded-lab-results/<run-id>/`.

## Voraussetzungen

- **lab-validate**: ein Skript auf Basis der Python-Standardbibliothek, das **Abhängigkeiten installieren** auf der Plugin-Seite automatisch installiert.
- Die Daten in der Workbench: Aufzeichnungsordner von scpi-instruments, CSV-Dateien, CSV-Exporte von sigrok-cli oder Laufordner von Transientenanalysen mit ngspice oder LTspice. Die SPICE-Plugins müssen nicht installiert sein, um ihre Laufordner zu lesen. Proprietäre Rohformate (`.sr`, `.raw`, Oszilloskop-Binärdateien) müssen zuerst mit ihrem eigenen Werkzeug konvertiert werden.
- Die Grenzwerte der Anforderung im Wortlaut sowie die Unsicherheit und Gerätebandbreite, die Sie für Ihren Aufbau begründen können.
- Keine benötigten Plugins, keine Hardware und keine Konfigurationsparameter.

## Verwendung

- „Was enthält die Aufzeichnung in embedded-lab-results/cap1?“
- „Prüfen Sie Anstiegszeit und Welligkeit der Oszilloskop-Aufzeichnung gegen REQ-PWR-12.“ (Skill `validation-planning`)
- „Vergleichen Sie den gemessenen Ausgang mit dem ngspice-Lauf, ausgerichtet auf die steigende Flanke des Eingangs.“
- „Warum ist Kriterium C2 unvollständig?“ (Skill `difference-explanation`)
- „Fassen Sie diese Vergleichsläufe zu einem Gesamturteil der Kampagne zusammen.“

Der Agent berechnet nie selbst eine Kennzahl oder ein Urteil und gibt nur wieder, was das Programm meldet. Er weitet nie einen Grenzwert, ein Fenster oder eine Toleranz aus, um ein Bestehen zu erreichen. Differenzen zwischen Messung und Simulation werden als Hypothesen angeboten, die an Belege im Ergebnis gebunden sind.

## Risiko und Freigaben

Jeder Befehl dieses Plugins ist sicher und läuft in jedem Berechtigungsmodus ohne Rückfrage, auch in Nur lesen. Er liest Dateien in der Workbench, ohne sie zu ändern, öffnet keine Netzwerkverbindung, startet kein anderes Programm und legt nur neue Laufordner an. Es gibt keine Befehle der Stufen Gerät lesen, Gerät schreiben oder Irreversibel.

## Grenzen

- Windows x64 und Linux x64.
- Ein Ergebnis ist keine Kalibrierung und keine messtechnische Zertifizierung; lab-validate leitet keine Unsicherheit her.
- Lücken, Clipping, offensichtliches Aliasing, unbekannte oder unzureichende Bandbreite sowie fehlende oder abweichende Bedingungen machen ein Kriterium unvollständig. Unvollständig ist kein Beinahe-Bestehen.
- Die Uhren verschiedener Messgeräte werden nie über Dateizeiten synchronisiert; die Ausrichtung verwendet deklarierte Marker, Offsets oder Kreuzkorrelation.
- Ein Urteil ist so vertrauenswürdig wie die Aufzeichnungs- und Laufordner, die es liest: Ihre Hashes stammen aus ihren eigenen Ergebnisdateien, und nichts ist signiert.
