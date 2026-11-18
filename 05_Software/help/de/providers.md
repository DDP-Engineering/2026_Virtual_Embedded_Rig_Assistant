# Anbieter und Modelle

Ein Anbieter gibt VERA Zugang zu einem Sprachmodell. Sie benötigen mindestens einen. Anbieter richten Sie unter **Einstellungen** → **Anbieter** ein; die Seite hat zwei Teile: **Abonnements** und **API- / lokale Verbindungen**.

## ChatGPT-Abonnement

1. Wählen Sie unter **ChatGPT-Abonnement** die Option **Mit ChatGPT anmelden**. Ihr Systembrowser öffnet die Anmeldeseite.
2. Melden Sie sich dort an. VERA zeigt **Mit ChatGPT angemeldet**, wenn der Vorgang abgeschlossen ist.

Das Token wird automatisch erneuert. **Abmelden** entfernt es.

- Wird die Anmeldung nicht abgeschlossen, fügen Sie die letzte Adresse aus dem Browser in **Die endgültige Weiterleitungs-URL einfügen, falls die Anmeldung nicht abgeschlossen wird** ein und wählen Sie **Anmeldung abschließen**.
- Die Anmeldung läuft nach 10 Minuten ab.
- Ist Port 1455 belegt, ist oft noch eine Anmeldung in der Codex CLI offen. Brechen Sie sie ab und versuchen Sie es erneut.

## OpenAI-API

1. Wählen Sie unter **API- / lokale Verbindungen** die Option **Verbindung hinzufügen** und als **Anbieter** die Option **OpenAI-API**.
2. Geben Sie den **OpenAI-API-Schlüssel** und optional ein **OpenAI-Modell** ein.
3. Wählen Sie **Speichern**.

## LM Studio

1. Starten Sie den LM-Studio-Server und laden Sie ein Modell.
2. **Verbindung hinzufügen**, **Anbieter** LM Studio. Die Adresse `http://localhost:1234` ist vorausgefüllt.
3. Wählen Sie **Verbindung testen**. VERA liest die Konversationsmodelle des Servers; Embedding-Modelle werden ausgelassen.
4. Prüfen Sie für jedes Modell das Kontextlimit, das VERA anzeigt. Meldet der Server keines, legen Sie es selbst fest. Die optionalen Werte **Reasoning** und **Temperatur** bleiben auf **Anbieterstandard**, sofern Sie sie nicht festlegen.
5. Wählen Sie **Speichern**.

Für LM Studio ist ein API-Schlüssel optional.

## Ollama und andere kompatible Endpunkte

1. **Verbindung hinzufügen**, **Anbieter** Ollama oder **Anderer kompatibler Anbieter**. Für Ollama ist die **Basis-URL** `http://localhost:11434/v1` vorausgefüllt.
2. Füllen Sie **Name des Endpunkts**, **Basis-URL** (eine `http`- oder `https`-Adresse, die auf `/v1` endet), **Modell** (der Modellname, wie ihn der Server kennt), **Kontextfenster (Tokens)** und **Maximale Ausgabe (Tokens)** aus.
3. Geben Sie unter **API-Schlüssel des Endpunkts** einen Schlüssel ein, wenn der Server einen benötigt, oder lassen Sie das Feld leer.
4. Wählen Sie **Speichern**.

Entnehmen Sie das Kontextfenster der Dokumentation des Modells oder Ihren Servereinstellungen. Ein zu großer Wert führt zu Fehlern des Servers; ein zu kleiner lässt VERA den Verlauf früher als nötig zusammenfassen.

## Bildunterstützung

VERA liest die Bildunterstützung aus den Modellkatalogen von ChatGPT und der OpenAI-API. Für LM Studio, Ollama oder einen anderen kompatiblen Endpunkt das Modell auswählen oder eingeben. Wenn es Bilder verarbeiten kann, **Akzeptiert Bilder** einschalten und **Speichern** wählen. Die Option ist für jedes Modell zunächst ausgeschaltet.

## Eine Verbindung testen

**Testen** führt vier Prüfungen aus: **Erreichbarkeit**, **Authentifizierung und Modell**, **Werkzeugaufrufe** und **Streaming**. Jede zeigt **Bestanden**, **Fehlgeschlagen** oder **Übersprungen**. Der Agent verwendet Werkzeugaufrufe, um Dokumente zu durchsuchen, Dateien zu lesen und zu ändern und Programme auszuführen; wählen Sie daher ein Modell, das **Werkzeugaufrufe** besteht.

## Schlüssel und sichere Speicherung

Schlüssel werden mit dem sicheren Speicher Ihres Betriebssystems verschlüsselt gespeichert. Ist dieser nicht verfügbar, lässt VERA Sie wählen: **Nur für diesen Lauf verwenden** hält den Schlüssel im Arbeitsspeicher, bis VERA beendet wird; **Ohne sichere Verschlüsselung speichern** speichert ihn in einer Datei, die jeder mit Zugriff auf Ihr Konto lesen kann. Um einen Schlüssel zu ersetzen, geben Sie einen neuen ein; um ihn zu entfernen, verwenden Sie **Gespeicherten Schlüssel entfernen**. **Entfernen** löscht eine Verbindung.

## Ein Modell wählen

- Für eine Sitzung: Wählen Sie das **Modell** neben dem Nachrichtenfeld.
- Für einen Workbench: **Workbench bearbeiten** → **Agent und Chat** → **Standardmodell**, geschrieben als `provider/model`. Lassen Sie das Feld leer, um den Standard der Anwendung zu verwenden.

Die Auswahl in der Sitzung hat Vorrang vor dem Standard des Workbenchs und dieser vor dem Standard der Anwendung.

## Häufige Fehler

| Meldung | Was zu tun ist |
|---|---|
| **Authentifizierung fehlgeschlagen. Gespeicherte Zugangsdaten in den Anbietereinstellungen prüfen.** | Geben Sie den Schlüssel erneut ein oder melden Sie sich erneut an |
| **Anbieterlimit erreicht.** | Warten Sie die angezeigte Zeit ab und versuchen Sie es dann erneut |
| **Der Anbieter hat die Kontextgröße abgelehnt.** | Kürzen Sie die Eingabe oder korrigieren Sie **Kontextfenster (Tokens)** |
| **… ist nicht erreichbar** | Starten Sie den lokalen Server oder prüfen Sie das Netzwerk und die **Basis-URL** |

Siehe auch [Fehlerbehebung](troubleshooting.md).
