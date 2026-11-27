# Chat und Sitzungen

## Ein zitiertes Paket in Wireshark öffnen

Wählen Sie in der Antwort des Agenten **Paket … in Wireshark öffnen** und dann **In Wireshark öffnen**. Installieren Sie Wireshark Desktop und TShark lokal. VERA prüft die zitierte PCAP- oder PCAPNG-Datei und öffnet eine geprüfte Kopie bei der Paketnummer dieser Datei. Das gilt auch für abgeleitete Mitschnitte.

Lassen Sie **Anzeigefilter** leer, um den Filter des Verweises zu verwenden, sofern vorhanden. Sie können einen anderen Offline-Anzeigefilter eingeben. Blendet der Filter das zitierte Paket aus, ergänzt VERA den Filter um dieses Paket und weist Sie darauf hin. Ist der Mitschnitt geändert worden oder nicht verfügbar, prüfen Sie ihn erneut, um einen neuen Verweis zu erhalten.

Eine Sitzung ist eine Unterhaltung mit dem Agenten innerhalb eines Workbenchs. VERA speichert jede Sitzung im Workbench, sodass Sie die App schließen und später weitermachen können. Mehrere Sitzungen können gleichzeitig laufen. Standardmäßig höchstens vier Durchläufe laufen gleichzeitig in allen geöffneten Workbenches, oder so viele, wie unter **Gleichzeitige Durchläufe** in [Erweiterte Einstellungen](advanced-settings.md) eingestellt; eine am Limit gesendete Nachricht bleibt ungesendet im Eingabefeld, bis ein Durchlauf endet.

## Sitzungen starten und verwalten

- **Neue Sitzung** startet eine Unterhaltung im geöffneten Workbench. Gibt es eine ungenutzte leere Sitzung, öffnet VERA diese, statt eine weitere anzulegen.
- Die erste Nachricht wird zum Titel. Mit **Umbenennen** vergeben Sie jederzeit einen neuen Titel, auch während eines Durchlaufs.
- Wählen Sie die Lupe **Sitzungen suchen** neben **Neue Sitzung**, um Sitzungen nach Titel und Nachrichteninhalt zu finden. Drücken Sie im Suchfeld **Esc** oder wählen Sie die Lupe erneut, um zur vollständigen Liste zurückzukehren. Mit den Seitensteuerelementen unter langen Listen gelangen Sie zu weiteren Sitzungen.
- Jede Sitzungszeile zeigt den Zeitpunkt der letzten Aktivität und hat ein Menü mit **Markdown exportieren**, **JSON exportieren**, **Umbenennen**, **Nach oben verschieben**, **Nach unten verschieben**, **Archivieren** und **Löschen**.
- Eine Sitzung zeigt ihren Zustand: **Bereit**, **Läuft**, **Wartet auf Freigabe** oder **Fehler**. Eine laufende Sitzung hat neben der Zeit ein drehendes Zeichen, eine auf Freigabe wartende einen Schild.

## Sitzungen in anderen Workbenches

Durchläufe laufen weiter, wenn Sie einen anderen Workbench öffnen. Eine Workbench-Zeile in der Seitenleiste zeigt ein Zeichen mit der Anzahl ihrer laufenden und wartenden Sitzungen, auch wenn die Zeile eingeklappt ist; ein Schild bedeutet, dass eine Sitzung auf Ihre Freigabe wartet. Wählen Sie das Zeichen (oder fokussieren Sie es und drücken Sie Enter), um diese Sitzungen anzuzeigen. Wählen Sie eine Sitzung, um sie in ihrem Workbench zu öffnen und dort die Freigabe zu prüfen, oder **Stoppen**, um nur diesen Durchlauf zu beenden. Solange Durchläufe laufen, zeigt **Workbenches**, wie viele laufen, und das Limit **Gleichzeitige Durchläufe**. Am Limit bleibt eine neue Nachricht im Eingabefeld: Warten Sie, bis ein Durchlauf endet, oder stoppen Sie einen in der Seitenleiste, und senden Sie sie dann erneut.

## Aktivität

Öffne **Aktivität** in der Titelleiste. Dort siehst du laufende Sitzungen, ausstehende Freigaben und Fragen sowie ungelesene Antworten aus allen Workbenches. Mit Tab wechselst du zwischen den Bedienelementen, mit Enter öffnest du einen Eintrag und mit Esc schließt du die Ansicht. VERA fragt nach, bevor ungespeicherte Änderungen verworfen werden. Bei einer offenen Frage springt VERA zur Fragekarte.

Ungelesene Antworten sind auch bei deaktivierten Desktop-Hinweisen verfügbar. VERA behält bis zu 100 erfolgreiche Antworten seit dem Start der Anwendung. Beim Öffnen einer ungelesenen Antwort wird sie als gelesen markiert. **Alle als gelesen markieren** leert die Liste der ungelesenen Antworten. Laufende Sitzungen und ausstehende Anfragen bleiben sichtbar.

## Eine Nachricht schreiben

Schreiben Sie in das Nachrichtenfeld (**Fragen Sie VERA zu Ihrem Projekt…**). Enter sendet, Shift+Enter fügt eine Zeile ein, und @ vervollständigt Pfade von Workbench-Dateien. Um dem Agenten eine Datei zu geben, wählen Sie im Tab **Dateien** an der Datei **Als Kontext anhängen**; sie erscheint als Chip über dem Nachrichtenfeld.

Neben dem Nachrichtenfeld wählen Sie **Modell**, **Reasoning-Stufe** und **Berechtigungsmodus** dieser Sitzung. Neue Sitzungen übernehmen Modell und Berechtigungsmodus aus den Workbench-Einstellungen.

Füge ein Bild aus der Zwischenablage in das Nachrichtenfeld ein, ziehe es dorthin oder wähle **Bild anhängen**, um eine Datei auszuwählen. Ziehe ein Bild aus Dateien in das Nachrichtenfeld oder wähle dort **Bild anhängen**. Entferne ein Bild über die Schaltfläche an seiner Vorschau. VERA speichert importierte Originale in der Workbench. Aus Dateien angehängte Bilder behalten ihre Pfade.

Wählen Sie die Miniaturansicht in einer gesendeten Nachricht aus, um das Bild in der Dateiansicht zu öffnen. Fehlt das Bild, zeigt die Nachricht den gespeicherten Workbench-Pfad.

Standardmäßig kann eine Nachricht bis zu acht PNG-, JPEG-, GIF- oder WebP-Bilder mit höchstens 20 MiB pro Datei enthalten. Die Limits lassen sich unter **Einstellungen** → **Erweitert** → **Bilder** ändern. Der Anbieter kann Anfragen ablehnen, die seine eigenen Limits überschreiten. VERA verkleinert die zum Modell gesendete Kopie auf höchstens 2048 Pixel an der längsten Seite und behält das Original. Ein reines Textmodell erhält die Dateipfade. Bei der Zusammenfassung älterer Nachrichten bleiben Bildpfade als Textnotizen erhalten. Sitzungsexporte enthalten diese Pfade.

Unter [Anbieter und Modelle](providers.md) steht, wie VERA die Bildunterstützung für das gewählte Modell ermittelt.

Geben Sie dem Agenten den relativen Pfad eines Bildes im Workbench, damit er es betrachten kann. Mit einem bildfähigen Modell kann der Agent über `view_image` PNG-, JPEG-, GIF-, WebP-, TIFF- und BMP-Dateien bis zur eingestellten Dateigröße lesen. Die längste Seite der an das Modell gesendeten Kopie ist höchstens 2048 Pixel lang. Das Werkzeug öffnet dieselben Dateien wie `read`: im Workbench, in den hinzugefügten Ordnern und im Umgehungsmodus überall auf dem Rechner. Das Ergebnis im Sitzungsverlauf enthält den Pfad. Unter **Workbench bearbeiten** → **Werkzeuge** erscheint der Schalter, wenn das Standardmodell des Workbenchs Bilder akzeptiert.

Der Agent kann ein in dieser Sitzung gesendetes Bild über seinen gespeicherten Pfad erneut öffnen. Pro Schritt kann er bis zu acht Bilder betrachten. Die acht zuletzt mit dem Werkzeug geöffneten Bilder bleiben im aktuellen Durchlauf verfügbar.

## Eine Nachricht diktieren

Wählen Sie ein Modell unter [Einstellungen > Diktat](settings.md). Halten Sie zum Diktieren die Mikrofontaste oder ihre Tastenkombination gedrückt. Wenn die Mikrofontaste fokussiert ist, halten Sie Leertaste oder Eingabetaste gedrückt. Lassen Sie zum Transkribieren los. Im Start/Stopp-Modus drücken Sie einmal für die Aufnahme und erneut für die Transkription. Mit Esc oder Diktat abbrechen verwerfen Sie die Aufnahme oder Transkription. Der Agent kann weiterarbeiten. Das Diktat wird abgebrochen, wenn Sie den Chat verlassen oder das Fenster den Fokus verliert.

Der Text erscheint an der ursprünglichen Cursorposition oder nach der Auswahl. Wenn Sie den Entwurf beim Diktieren bearbeitet haben, wird das Diktat am Ende eingefügt. Text und Anhänge bleiben erhalten. Prüfen Sie den Entwurf und senden Sie ihn mit der Eingabetaste oder mit Senden.

## Einen laufenden Durchlauf steuern oder stoppen

Während der Agent arbeitet, können Sie weiterschreiben und weitere Nachrichten senden, zum Beispiel „prüfe auch die Errata“. Sie zeigen **Zustellung ausstehend**, bis der Agent sie bei seinem nächsten Schritt aufnimmt. Sie können den Entwurf weiter bearbeiten, während VERA eine Nachricht sendet oder auf Ihre Freigabe wartet. Sobald die Nachricht angenommen oder über die Freigabe entschieden wurde, können Sie wieder senden. Der Entwurf bleibt beim Ansichtswechsel in seiner Sitzung.

**Stoppen** beendet den laufenden Durchlauf. Escape öffnet **Laufenden Durchlauf stoppen?** mit Fokus auf **Stoppen**. Drücken Sie Enter, um den Durchlauf zu stoppen. Bereits abgeschlossene Arbeit, etwa angewendete Dateiänderungen, bleibt erhalten.

## Eine Frage beantworten

Wenn VERA eine Frage stellt, wähle eine Antwort oder gib eine eigene ein. Wählen Sie **Antwort senden** oder drücken Sie Enter im Antwortfeld. Sie können auch im Nachrichtenfeld antworten. Antworten dürfen bis zu 2.000 Zeichen lang sein und keine Bilder enthalten. Zu lange Entwürfe oder Entwürfe mit Bildern bleiben zur Bearbeitung im Nachrichtenfeld. Die Empfehlung ist auf der Karte markiert. Mit **Frage abbrechen** läuft der Durchlauf mit einem Abbruch als Antwort weiter. Du kannst auch den ganzen Durchlauf stoppen. Öffne eine wartende Frage über das Aktivitätsmenü der Workbench.

In den Workbench-Einstellungen unter **Agent und Chat** ist **Empfohlene Antworten nach einer Wartezeit übernehmen** standardmäßig aus. Nach dem Einschalten sind 1 bis 1440 ganze Minuten erlaubt. Bei gültiger Empfehlung zeigt die Karte den Zeitpunkt an, und der Chat kennzeichnet automatische Antworten. Die Zeit läuft im Hintergrund und beim Neuladen weiter. Genehmigungspflichtige Vorgänge fragen weiterhin gesondert nach.

## Delegierte Sitzungen verfolgen

Wenn VERA eine Aufgabe delegiert, erscheint die untergeordnete Sitzung eingerückt unter der übergeordneten Sitzung in der Sitzungsliste, mit dem Ergebnis ihres letzten delegierten Durchlaufs. Mit dem Pfeil vor der übergeordneten Sitzung blendest du ihre untergeordneten Sitzungen ein oder aus; VERA merkt sich das für den Workbench. Solange sie ausgeblendet sind, zeigt die übergeordnete Zeile, wenn eine davon auf dich wartet, fehlgeschlagen ist oder läuft. Wähle eine Sitzung aus, um ihren Chat zu öffnen und den Verlauf zu verfolgen; öffnest du sie aus der Aktivität oder einer Benachrichtigung, wird sie in der Liste angezeigt. Zurück zur übergeordneten Sitzung gelangst du über ihre Zeile oberhalb der untergeordneten Sitzungen. **Nach oben verschieben** und **Nach unten verschieben** bewegen eine untergeordnete Sitzung unter ihren Geschwistern und eine übergeordnete Sitzung zusammen mit ihren untergeordneten. Eine untergeordnete Sitzung, deren übergeordnete Sitzung archiviert ist oder in den Ergebnissen fehlt, steht für sich.

Öffne eine laufende untergeordnete Sitzung und wähle **Stoppen** bei der Nachrichteneingabe, um sie anzuhalten. Die übergeordnete Sitzung kann weiterarbeiten. Wenn eine Genehmigung erforderlich ist, verwende die Genehmigungskarte in der jeweiligen Sitzung. Beim erneuten Öffnen nach einem Neustart von VERA bleiben der Link und das Ergebnis des delegierten Durchlaufs verfügbar.

Der übergeordnete Agent kann weitere Anweisungen im selben untergeordneten Chat senden und Modell sowie Denkstufe für spätere Durchläufe wählen. Der Verlauf kennzeichnet diese Nachrichten als **Anweisung des übergeordneten Agenten**. Während die untergeordnete Sitzung arbeitet, wartet eine zulässige Nachricht auf die nächste Modellanfrage. Ist eine Entscheidung erforderlich, nutze die Genehmigungskarte der untergeordneten Sitzung.

Der übergeordnete Agent kann prüfen, ob eine Anweisung noch wartet und welcher Durchlauf sie erhalten hat. Wird die untergeordnete Sitzung vor der Zustellung angehalten, kann die Anweisung im nächsten Durchlauf ankommen. Beim Anhalten fordert VERA auch das Beenden ihrer Hintergrundprogramme an, einschließlich der Programme aus früheren Durchläufen.

Eine neue untergeordnete Sitzung startet im aktuellen Berechtigungsmodus der übergeordneten Sitzung. Delegiert eine Sitzung im Bypass-Modus, startet die neue Sitzung in Automatisch bearbeiten, außer du aktivierst unter **Einstellungen > Daten & Datenschutz** die Option **Vollzugriff für delegierte Aufgaben erlauben** und bestätigst. Die Option ist standardmäßig aus und gilt für künftige Starts in allen Workbenches; schaltest du sie aus, behalten bestehende Sitzungen ihren Modus. Danach wählst du den Modus in jeder Nachrichteneingabe separat. Verringere den Zugriff einer untergeordneten Sitzung in ihrem eigenen Chat.

Lass in einer gemeinsam genutzten Arbeitskopie jeweils eine untergeordnete Sitzung fertig werden und überprüfe ihre Übergabe vor dem nächsten Start.

Eine delegierte Sitzung im Bypass-Modus folgt denselben Regeln wie eine direkte Bypass-Sitzung: Shell-Befehle, Plugin-Programme und Dateiänderungen laufen ohne Nachfrage, auch Veröffentlichungen auf entfernten Systemen wie `git push`. Gesperrte Programme, die Prüfung von Plugin-Installationen und Test-Plugins behalten ihre eigenen Genehmigungen. In Automatisch bearbeiten laufen Shell-Befehle nur automatisch, wenn sie mit einem von dir gespeicherten Workbench-Befehlspräfix übereinstimmen; andere Befehle benötigen deine Genehmigung im Chat der untergeordneten Sitzung.

## Detailgrade

**Detailgrad** wird pro Workbench unter **Workbench bearbeiten** → **Agent und Chat** festgelegt:

| Stufe | Was die Unterhaltung zeigt |
|---|---|
| **Ausführlich** | Jeden Werkzeugaufruf mit Argumenten und Ausgabe, das Reasoning des Modells und unter jeder Ihrer Nachrichten Sendedatum, Uhrzeit und Token-Statistiken |
| **Normal** | Routinemäßige Werkzeugaufrufe, gruppiert in einer aufklappbaren Zeile **Vorgänge** |
| **Minimal** | Nur die Unterhaltung; routinemäßige Werkzeugaufrufe sind ausgeblendet, und eine Arbeitsanzeige ist zu sehen, solange der Agent arbeitet |

Freigaben, die auf Sie warten, Fehler und Download-Karten werden auf jeder Stufe angezeigt; gewöhnliche automatische Freigaben werden bei **Minimal** ausgeblendet und bei **Normal** gruppiert. Schreibzugriffe auf Geräte und irreversible Plugin-Vorgänge bleiben sichtbar. Die Stufe ändert nur die Anzeige; die gespeicherte Sitzung und ihre Exporte sind immer vollständig.

Werkzeugaktivitäten zeigen eine kurze Aktionsbeschreibung, die betroffene Datei, Seite oder den Befehl und den Status. Klappen Sie sie für das Ergebnis oder den genauen Befehl und Arbeitsordner auf. **Technische Details** enthält Werkzeugname, Dauer, ursprüngliche Argumente und Rohergebnis; große gespeicherte Auszüge lassen sich weiterhin vollständig laden. Ein Exitcode ungleich null erscheint als Fehler, Hintergrundläufe sind gesondert gekennzeichnet. Detailstufen und Genehmigungsanfragen behalten ihr Verhalten. Aufgeklappte Planaktualisierungen zeigen die tatsächlichen Aufgaben und ihren Status; technische Details bleiben optional und getrennt.

## Reasoning

Bei Modellen, die es unterstützen, bietet **Reasoning-Stufe** die Option **Standard** und die Stufen, die das Modell angibt, zum Beispiel **Minimal**, **Niedrig**, **Mittel**, **Hoch** oder **Maximum**. Auf höheren Stufen denkt das Modell länger nach, bevor es antwortet. Bei Modellen ohne Reasoning-Stufen ist das Steuerelement ausgeblendet. Sie können die Stufe während eines Durchlaufs ändern; die neue Stufe gilt ab der nächsten Anfrage. Der Reasoning-Text selbst wird nur bei **Ausführlich** angezeigt.

## Lange Sitzungen und Kontext

Die Kontextanzeige zeigt **Kontextnutzung** als Prozentsatz des Kontextfensters des Modells; wählen Sie sie aus, um Nutzung und Limits zu sehen. Wird eine Sitzung für das Modell zu lang, fasst VERA den älteren Verlauf zusammen (**Verlauf wird zusammengefasst…**). Währenddessen dreht sich die Anzeige und behält den letzten Prozentsatz, der sich aktualisiert, sobald die nächste Anfrage bereit ist. Das vollständige Transkript bleibt gespeichert und sichtbar.

Schlägt der letzte Durchlauf wegen eines vorübergehenden Anbieterfehlers fehl, senden Sie seine Nachricht mit **Erneut versuchen** noch einmal. Bei einem Kontextlimit wählen Sie, sofern verfügbar, **Jetzt kompaktieren**. Bei Erreichen des Ausgabe- oder Werkzeugaufruflimits startet **Fortsetzen** einen weiteren Durchlauf.

Lehnt der Anbieter die Anfrage wegen ihrer Größe ab, wählen Sie **Bilder ändern und erneut versuchen**. Entfernen Sie die Häkchen bei den gewünschten Anhängen und wählen Sie **Nachricht erneut senden**. Die ursprünglichen Anhänge bleiben im Chat sichtbar.

**In Unterhaltung suchen** durchsucht die aktuelle Sitzung. Mit Enter springen Sie zum nächsten Treffer, mit Shift+Enter zum vorherigen. Das Senden einer Nachricht oder **Zur neuesten Nachricht** bringt Sie ans Ende. Die Markierungsleiste am linken Rand der Unterhaltung hat eine Markierung pro Nachricht von Ihnen; zeigen Sie auf eine Markierung, um eine Vorschau der Nachricht zu sehen, und wählen Sie sie aus, um dorthin zu springen.

## Archivieren, löschen und exportieren

- **Archivieren** verschiebt eine abgeschlossene Sitzung in **Archivierte Sitzungen**; **Wiederherstellen** holt sie zurück. Nichts geht verloren.
- **Löschen** entfernt die Sitzung und ihre Artefakte nach einer Bestätigung. Dateien, die der Agent heruntergeladen hat, bleiben im Workbench.
- **Markdown exportieren** schreibt ein lesbares Transkript mit Werkzeugzusammenfassungen, Quellenverweisen und angewendeten Änderungen; **JSON exportieren** schreibt die vollständige Ereignisaufzeichnung. Beide öffnen einen Speichern-Dialog und funktionieren auch in schreibgeschützten Workbenches.

Gespeicherte Nachrichtenlesezeichen bleiben im JSON-Export erhalten; Markdown kennzeichnet markierte Nutzernachrichten. Lesezeichen gehören zur Sitzung und werden nicht an den Agenten gesendet.

## Der rechte Bereich

Bitten Sie den Agenten, ein gespeichertes Textartefakt in derselben Sitzung zu finden und erneut zu
verwenden. Das geht auch nach dem erneuten Öffnen. Für ein bestimmtes Artefakt geben Sie seine genaue Referenz `artifact:...` an.

**Rechten Bereich ein- oder ausblenden** zeigt Tabs für die geöffnete Sitzung: **Anweisungen und Skills** (Workbench-Anweisungen und verfügbare Skills), **Dateien**, **Änderungen**, **Artefakte** (Textergebnisse, die der Agent gespeichert hat, mit **Exportieren** und **Im Ordner anzeigen**), **Plan** (die Aufgabenliste des Agenten) und **Läufe** (Programmläufe von Plugins).

Wählen Sie unter **Änderungen** eine Bearbeitung, um ihren Diff neben Chat zu öffnen.

## Offene Tabs

Mit **Zuletzt geschlossenen Tab wieder öffnen** neben Chat stellst du ein Dokument oder einen Vergleich der aktuellen Sitzung wieder her. Wähle im Kontextmenü **Tab anheften**, um ihn neben Chat zu halten und beim Schließen mehrerer Tabs zu behalten. Wähle **Offene Tabs durchsuchen**, um nach Titel oder Pfad zu filtern. Wähle einen Treffer per Klick oder mit Pfeiltasten und Eingabetaste.

Wähle im Menü eines offenen Tabs **Neben Chat anzeigen**. Der Chat bleibt links sichtbar, der Tab erscheint rechts. Wähle einen anderen Tab, um rechts zu wechseln. Ziehe die Trennlinie oder nutze darauf die Pfeiltasten. **Geteilte Ansicht schließen** wechselt zur Einzelansicht und lässt die Tabs offen. In einem schmalen Fenster wechselst du über die Tableiste.

## Plan kommentieren und prüfen

Wähle **Plan öffnen** im Chat, um die Schritte des aktuellen Plans zu sehen. Antworte auf eine Planentscheidung in der Fragekarte. Wenn du in einer anderen Sitzung bist, öffnet die Benachrichtigung oder der Eintrag in **Aktivität** die Sitzung und den Tab **Plan**.

Wählen Sie in **Plan** **Kommentar hinzufügen** für einen ganzen Schritt oder markieren Sie vorher Text in genau einem Schritt, um diesen Ausschnitt zu zitieren. Mit der Tastatur markieren Sie im **Schritttext** mit Shift und Pfeiltasten und wählen **Ausgewählten Text verwenden**; **Gesamter Schritt** entfernt den Ausschnitt. Leere Schritte erlauben nur Kommentare zum gesamten Schritt. Schreiben Sie mehrzeiliges Feedback, etwa „Spannung vor dem Flashen prüfen“, und wählen Sie **Entwurf speichern**. Speichern sendet keine Nachricht und startet keinen Agenten. Abbrechen oder Escape verwirft ungespeicherte Änderungen und setzt den Fokus zurück auf Plan.

Die Anzahl der Entwürfe und übermittelten Kommentare öffnet die Kommentare für genau diesen Schritt. **Feedback bearbeiten** ändert nur den Text; **Feedback löschen** entfernt einen Entwurf. Jede Planersetzung macht frühere Verankerungen ungültig, auch bei gleichem Text. **Neue Verankerung erforderlich** hält diese Entwürfe lesbar: Wählen Sie **Neu verankern**, einen nummerierten aktuellen Schritt, ausdrücklich den gesamten Text oder einen Ausschnitt und dann **Verankerung speichern**. Gespeicherte Entwürfe bleiben beim Schließen oder Wechseln von Sitzungen erhalten.

**Plan prüfen** sendet den gesamten aktuellen Plan und alle gültigen Entwürfe als eine Anfrage im selben Chat. Der Agent kann den strukturierten Plan ändern oder Rückfragen stellen, aber dabei keine Schritte ausführen, Projektdateien ändern, Programme oder Befehle starten oder Berechtigungen erteilen. Normale Chatnachrichten sind bis zum Ende gesperrt; **Stoppen** beendet nur die Prüfung, nicht unabhängige Hintergrundprogramme. Der schreibgeschützte Berechtigungsmodus erlaubt Planänderungen; archivierte Sitzungen und schreibgeschützte Workbenches erlauben nur das Anzeigen.

**Frühere Prüfungen** bewahrt übermittelte Kommentare, Zitate und Ergebnisse auch bei leerem Plan auf. Scheitert die Übermittlung, bleiben Entwürfe erhalten. **Prüfung erneut versuchen** bestätigt eine unbekannte Empfangsbestätigung mit der ursprünglichen Anfrage, ohne eine zweite Prüfung anzulegen. Nach einer angenommenen, aber fehlgeschlagenen, gestoppten oder kontextbegrenzten Prüfung stellt **Feedback wiederherstellen** fehlende Entwürfe bereit, ohne bearbeitete Entwürfe oder den Verlauf zu überschreiben. Erneutes Versuchen im Chat macht dasselbe. Verankern Sie veraltete Entwürfe neu und wählen Sie ausdrücklich wieder **Plan prüfen**; Wiederherstellen sendet nie automatisch eine Anfrage. Bestehende Kontextgrenzen der Unterhaltung gelten weiterhin.

Datenschutz- oder Modelländerungen aktualisieren die Anzeige. Der offene Editor behält ungespeichertes Feedback, blendet aber das zuvor erfasste Zitat aus; wählen Sie ausdrücklich ein aktuelles Ziel, bevor Sie einen neuen Kommentar oder eine neue Verankerung speichern.

## Lesezeichen

Bewegen Sie den Zeiger über eine eigene Nachricht oder erreichen Sie ihr Lesezeichensymbol mit Tab. **Lesezeichen setzen** markiert sie; das gefüllte Symbol bietet **Lesezeichen entfernen**. Die Vorschau an der Leiste zeigt die erste Nachrichtenzeile und den Anfang der Agentenantwort mit derselben Lesezeichenaktion. Änderungen erscheinen sofort; bei einem Speicherfehler wird der vorherige Zustand wiederhergestellt und ein Fehler angezeigt. Archivierte Sitzungen und schreibgeschützte Workbenches erlauben nur das Anzeigen.

Markierte Positionen auf der Leiste sind gefüllt, in der Primärfarbe und etwas länger. Eine Gruppe ist markiert, sobald eine ihrer Nachrichten ein Lesezeichen hat. Mit **Nächstes Lesezeichen** (**Ctrl+Alt+N**) und **Vorheriges Lesezeichen** (**Ctrl+Alt+P**) springen Sie zwischen markierten Nachrichten; am ersten oder letzten Lesezeichen endet die Navigation. Ändern Sie die Tasten unter **Einstellungen → Tastenkombinationen**.

Der Tab **Lesezeichen** im rechten Bereich listet die Lesezeichen dieser Unterhaltung der Reihe nach, jeweils mit dem Anfang Ihrer Nachricht und der Antwort. Schalten Sie ihn unter **Workbench bearbeiten > Oberfläche > Tabs im rechten Bereich** ein. Tippen Sie in **Lesezeichen filtern**, um Nachrichten- oder Antworttext zu finden; die Anzahl zeigt dann Treffer von der Gesamtzahl. Wählen Sie eine Zeile oder drücken Sie die Eingabetaste, um im Chat zu dieser Nachricht zu springen; die Pfeiltasten wechseln zwischen Zeilen. Markieren Sie Zeilen (oder **Alle auswählen** für die gefilterten Zeilen) und wählen Sie **Auswahl entfernen**, oder entfernen Sie eine Zeile mit ihrem Papierkorbsymbol. **Alle entfernen** entfernt nach Bestätigung alle Lesezeichen der Unterhaltung, unabhängig vom Filter. Das Entfernen eines Lesezeichens löscht nie eine Nachricht; schlägt es fehl, ändert sich nichts und ein Fehler erscheint. Archivierte Sitzungen und schreibgeschützte Workbenches erlauben nur Filtern und Springen.

## Shell-Befehle

Nutzen Sie nicht interaktive Optionen: die Standardeingabe des Agenten ist geschlossen. Vordergrundbefehle liefern den Exitcode, die letzten 12.000 Ausgabezeichen und das vollständige Protokoll in `.vera/runs`. Hintergrundbefehle liefern eine Kennung; der Agent liest `program_output`, nutzt `until` für eine Bereitschaftsmeldung und beendet sie mit `program_stop`. Sie überleben einen abgeschlossenen Werkzeugaufruf und enden mit Sitzung, App oder dem Bypass-Modus, der sie gestartet hat. Die lokale Ansicht der Läufe folgt der Geheimnismaskierung für Programmläufe; lokale Protokolle behalten die Originalausgabe. Kindprozesse erben Benutzerumgebungsvariablen ohne VERA-Anbieterschlüssel oder gespeicherte Zugangsdaten. Befehle sind auf 4.096 Zeichen begrenzt.

Befehlsfreigaben und gespeicherte Präfixe sind unter [Berechtigungen](permissions.md) beschrieben, Ordner außerhalb des Workbenchs unter [Workbenches](workbenches.md).

## Befehle in Läufe

Öffnen Sie **Läufe** im rechten Bereich für den genauen Befehl, Ordner, laufende Ausgabe, Exit-Code und Dauer. **Stoppen** beendet den gesamten Prozessbaum; der Agent sieht den Stopp beim nächsten Lesen der Ausgabe. Bei beendeten Läufen öffnet **Protokoll öffnen** das aufbewahrte Protokoll im Textbetrachter, auch die Ausgabe vor dem angezeigten Ende; von einem Protokoll über 8 MiB werden die letzten 8 MiB angezeigt. Standardmäßig ist die aktuelle Sitzung ausgewählt; **Alle Sitzungen** zeigt andere Läufe. Plugin-Läufe behalten ihre deklarierten Programmnamen. Die Maskierung von Programmläufen ist standardmäßig aus. Eingeschaltet maskiert sie gespeicherte Geheimnisse in Argumenten, Befehlen, Ordnern, Fehlern, Ausgaben und Programmstatus. Die Workbench-Auswahl hat Vorrang vor dem App-Standard. Änderungen aktualisieren offene Protokolle einschließlich vollständiger Protokolle im Betrachter; lokale Protokolle behalten den Originaltext.

## Benutzerterminal

Öffnen Sie **Terminal** rechts oder drücken Sie **Ctrl+Shift+T**. Die interaktive Shell startet im Workbench-Ordner gemäß Einstellungen → Befehle. **Neues Terminal** erstellt Tabs; **Terminal schließen** beendet sie. Größenänderungen brechen die Ausgabe neu um. Interaktive Programme nehmen Ihre Eingaben an. Das Ende einer Agentensitzung lässt Benutzerterminals weiterlaufen; Schließen oder Wechseln des Workbenchs und Beenden von VERA schließen sie. Native Terminalunterstützung ist enthalten.

Antworten und Codeblöcke haben getrennte Kopieraktionen. Ausführen ist für vollständige, ausdrücklich als PowerShell oder Bash markierte Blöcke mit 1–16.384 Zeichen ohne Terminalsteuerzeichen verfügbar. Befehle gehen nur an eine unbenutzte saubere Shell, deren leere Anfangseingabezeile vor der Ausführung geprüft wird. Nur geeignete Ziele werden angeboten; gibt es keines, erstellt Ausführen sofort ein sauberes Terminal. Erhält das Ziel nach der Auswahl Eingaben oder führt einen Befehl aus, verweigert VERA das Einfügen und bietet **In einem neuen sauberen Terminal ausführen** an. Unabgesendeter Text und interaktive Programme bleiben unberührt. Saubere Terminals überspringen Shellprofile; **Neues Terminal** verwendet weiterhin den normalen Start der konfigurierten Shell. **Neues sauberes Terminal (ohne Shellprofil)** erstellt eine separate passende Shell. Abbrechen oder Escape setzt den Tastaturfokus auf Ausführen zurück.

Jedes Terminal beginnt privat. Wie Sie dem Agenten das Lesen eines Terminals erlauben, steht unter [Berechtigungen](permissions.md).

## Geheimnismaskierung für Agent und Exporte

Agent und Modell maskiert Werkzeugergebnisse für den Anbieter, gestreamte Antworten sowie Suche und Anzeige von Sitzungen. Die Maskierung prüft den Dateipfad als Text. Bildpixel liegen außerhalb ihres Geltungsbereichs. Artefakte und Exporte steuert unabhängig davon gespeicherte Artefaktinhalte und Beschreibungen, Artefaktexporte und JSON-/Markdown-Sitzungsexporte. Beide sind standardmäßig aktiv; eine ausdrückliche Workbench-Auswahl hat Vorrang vor dem aktuellen App-Standard. Ohne Agentenmaskierung können gespeicherte Geheimnisse aus Dateien oder Werkzeugausgaben den Anbieter erreichen. Programmläufe und Anzeige ändern diese Regeln nicht. Anbieterfehler, Verbindungstests und Diagnoseprotokolle maskieren gespeicherte Zugangsdaten immer. Terminalzugriffe benötigen weiterhin die Zustimmung für genau dieses Terminal. Bereits als [REDACTED] gespeicherter Text wird durch Ausschalten nicht wiederhergestellt; lesen Sie die Originalquelle neu oder erstellen Sie das Artefakt erneut.
