# Anbieter und Modelle

Ein Anbieter gibt VERA Zugang zu einem Sprachmodell. Sie benötigen mindestens einen. Anbieter richten Sie unter **Einstellungen** → **Anbieter** ein; die Seite hat zwei Teile: **Abonnements** und **API- / lokale Verbindungen**.

Wählen Sie **Verbindung hinzufügen** und nutzen Sie **Anbieter suchen**, um einen Anbieter nach Namen zu finden.

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

## OpenCode Console und OpenCode Go

1. Erstelle in OpenCode Console einen API-Schlüssel für den Workspace. Erteile ihm Leserechte für Modelle und die Berechtigung zur Inferenz.
2. Wähle in VERA **Verbindung hinzufügen** und dann **OpenCode Console** für die nutzungsabhängige Abrechnung oder **OpenCode Go** für das Go-Abo.
3. Gib den Schlüssel ein und suche nach Modellen. Wähle ein Modell aus der Liste des Tarifs oder gib für eine manuelle Einrichtung die genaue ID und die Limits ein.
4. Speichere und teste die Verbindung. Wähle das Modell für deine Sitzung oder Workbench.

VERA speichert den Schlüssel jeder Verbindung separat. Du kannst denselben Schlüssel für beide Verbindungen verwenden, wenn der Workspace über Guthaben und ein Go-Abo verfügt. Kostenlose Console-Modelle sind nur in OpenCode verfügbar. Die Workspace-Limits und die Go-Option Extra Usage bestimmen, wann OpenCode das Guthaben belasten kann.

Der Katalog zeigt die Modellfunktionen. Mit dem Verbindungstest kannst du Werkzeugaufrufe und Streaming für das ausgewählte Modell prüfen.

Siehe [OpenCode-Einrichtung](https://opencode.ai/docs/console/harnesses) und [Anleitung zum Go-Tarif](https://opencode.ai/docs/console/go/).

## QwenCloud Standard und QwenCloud Token Plan

1. Wähle unter **Verbindung hinzufügen** **QwenCloud Standard** für einen nutzungsabhängig abgerechneten API-Schlüssel aus Singapur oder **QwenCloud Token Plan** für den zugehörigen Aboschlüssel (`sk-sp-`). VERA trägt die Basis-URL des gewählten Tarifs ein.
2. Gib den passenden Schlüssel ein und wähle **Modelle suchen**. Ist die Liste nicht verfügbar, gib die genaue Modell-ID für deine Region oder deinen Tarif ein. `qwen3.8-flash` akzeptiert beispielsweise Text und Bilder, kann Werkzeuge aufrufen und bietet einen ein- und ausschaltbaren Denkmodus. `qwen3.7-max` bietet Werkzeugaufrufe und denselben Denkmodus mit Texteingabe. Bei anderen Modell-IDs können die Fähigkeiten ungeprüft sein.
3. Wähle **Speichern** und dann **Testen**. Wird die Katalogerreichbarkeit übersprungen, prüft der Schritt für Authentifizierung und Modell den Schlüssel und das Modell mit einer Chat-Anfrage. Wähle das Modell für deine Sitzung oder Workbench.

Nutze Token Plan für interaktive Agenssitzungen gemäß der [Nutzungsrichtlinie für Token Plan](https://docs.qwencloud.com/token-plan/token-plan-permissions-and-usage). Ist das Guthaben aufgebraucht, prüfe Verbrauch und Kontingent des Tarifs. Bei zu vielen Anfragen warte vor dem nächsten Versuch.

Siehe [QwenCloud-API-Schlüssel](https://docs.qwencloud.com/developer-guides/administration/api-keys) und [Token-Plan-Modelle und Fehler](https://docs.qwencloud.com/token-plan/token-plan-faq).

## DeepSeek, Moonshot AI und Kimi For Coding

1. Wähle unter **Verbindung hinzufügen** den Eintrag **DeepSeek** für einen DeepSeek-API-Schlüssel, **Moonshot AI** für einen Schlüssel der internationalen Kimi-API-Plattform oder **Kimi For Coding** für einen Schlüssel aus der Kimi-Code-Konsole. VERA trägt die Basis-URL des Dienstes ein.
2. Gib den Schlüssel des Dienstes ein. Wähle bei DeepSeek und Moonshot AI **Modelle suchen** oder gib die genaue Modell-ID ein. Gib bei Kimi For Coding je nach Tarif eine ID wie `kimi-for-coding` oder `k3-256k` ein.
3. Wähle **Speichern** und dann **Testen**. Bei Kimi For Coding wird die Erreichbarkeitsprüfung übersprungen. Die Prüfung von Authentifizierung und Modell sendet eine Anfrage an das Modell.

Gib die genaue Modell-ID für Kimi For Coding ein. Bei einem Tippfehler kann Kimi Code mit einem Ersatzmodell antworten. Ein erfolgreicher Test lässt die Fähigkeiten ungeprüfter Kimi-IDs offen.

DeepSeek Flash, Kimi K3 von Moonshot AI und die beiden Kimi-Code-Beispiele nehmen in VERA Text und Bilder an. DeepSeek V4 Pro nimmt Text an. Die Fähigkeiten anderer Modelle können ungeprüft sein.

Siehe [DeepSeek-Modellgrenzen](https://api-docs.deepseek.com/api/list-models/), den [Leitfaden zu Moonshot Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) und die [Kimi-Code-Modellkonfiguration](https://www.kimi.com/code/docs/en/kimi-code/models).

## MiniMax und Z.AI

1. Wähle unter **Verbindung hinzufügen** den Eintrag **MiniMax API** für einen verbrauchsabhängig abgerechneten Schlüssel (`sk-api-`) oder **MiniMax M Plan** für einen MiniMax-Abonnementschlüssel (`sk-cp-`). Beide verwenden den internationalen Messages-Dienst.
2. Wähle **Z.AI API** für einen Standard-API-Schlüssel. **Z.AI GLM Coding Plan** verwendet die eigene internationale Adresse des Coding-Tarifs. Verwende einen Personal-Coding-Plan- oder Team-Plan-Schlüssel nur, wenn Z.AI den Zugriff aus VERA genehmigt hat. Z.AI beschränkt den Tarif auf unterstützte Werkzeuge. VERA steht nicht auf der veröffentlichten Liste. Prüfe den Schlüsseltyp in deinem Konto, da manche Schlüssel an mehreren Adressen funktionieren und die Abrechnung von Schlüssel und Adresse abhängt.
3. Wähle ein vorgeschlagenes Modell oder gib die für dein Konto freigeschaltete Modell-ID ein. Wähle **Speichern** und dann **Testen**. Der Test sendet Modellanfragen, die das Kontingent belasten können. Wähle das gespeicherte Modell für deine Sitzung oder Workbench.

`MiniMax-M3.1-Flash` und `glm-5.3-flash` verarbeiten Text und Bilder, unterstützen Werkzeugaufrufe und bieten Denkstufen. Bei MiniMax API verarbeitet `MiniMax-M3` Text und Bilder und lässt den Denkmodus ein- oder ausschalten. `glm-5.3` verarbeitet Text und bietet Werkzeugaufrufe und Denkstufen. Die Fähigkeiten anderer manuell eingegebener Modell-IDs bleiben ungeprüft.

Siehe [Einrichtung der MiniMax-Schlüssel](https://platform.minimax.io/docs/guides/quickstart-preparation), [Schlüsselverwaltung bei Z.AI](https://docs.z.ai/devpack/notice/api-key-management) und [von Z.AI unterstützte Werkzeuge](https://docs.z.ai/devpack/tool/others#supported-tools).

## Alibaba Cloud und Xiaomi MiMo

1. Wähle **Alibaba Cloud Model Studio** für nutzungsbasierte Abrechnung. Wähle die Region aus der Model Studio-Konsole, kopiere die **Arbeitsbereichs-ID** (beginnt mit `llm-`) und gib einen Schlüssel für diesen Arbeitsbereich ein.
2. Wähle **Alibaba Cloud Coding Plan** für einen internationalen Coding-Plan-Schlüssel (`sk-sp-`). Verwende die Verbindung für Singapur. QwenCloud Standard und Token Plan haben eigene Voreinstellungen und Kontoschlüssel.
3. Wähle **Xiaomi MiMo API** für einen Echtzeit-API-Schlüssel (`sk-`) am globalen Endpunkt. Wähle für **Xiaomi MiMo Token Plan** die Region deiner Token-Plan-Seite (China, Singapur oder Europa) und verwende den Einzel- (`tp-`) oder Teamschlüssel (`ttp-`).
4. Wähle **Modelle suchen**, falls verfügbar, oder gib die genaue Chatmodell-ID aus der Konsole des Anbieters ein. Wähle **Speichern** und danach **Testen**. Der Test verwendet den gewählten Endpunkt und kann Kontingent verbrauchen. Wähle ein Modell für die Sitzung oder Workbench.

Probiere `qwen3.7-flash` in Model Studio, `qwen3.7-plus` im Coding Plan oder `mimo-v2.6-flash` in MiMo, sofern das Konto Zugriff hat. Ein Katalogeintrag allein bestätigt den Kontozugriff nicht. Bei weiteren manuell eingegebenen IDs können Modellfähigkeiten ungeprüft bleiben. Füge für eine andere Region oder einen anderen Arbeitsbereich eine Verbindung hinzu.

Siehe [Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq), [MiMo API](https://mimo.mi.com/docs/en-US/api/chat/openai-api-post), [MiMo Token Plan](https://mimo.mi.com/docs/tokenplan/subscription).

Verwende Alibaba Coding Plan gemäß Alibabas Nutzungsrichtlinie in unterstützten interaktiven Programmierwerkzeugen. Verwende MiMo Token Plan gemäß Xiaomis Nutzungsrichtlinie für Programmieraufgaben.

## Fireworks AI, Together AI, Groq und Cerebras

1. Wähle unter **Verbindung hinzufügen** den Dienst aus und gib einen API-Schlüssel aus dessen Konsole ein. VERA trägt die Dienstadresse ein und speichert den Schlüssel für jede Verbindung separat.
2. Wähle **Modelle suchen** oder gib die vollständige Modell-ID und die Modellgrenzen ein. Gib bei Fireworks das Kontopräfix mit an, etwa `accounts/fireworks/models/glm-5p3-flash`. Kopiere für einen dedizierten Endpunkt die genaue Inferenz-ID aus der Dienstkonsole.
3. Speichere und wähle **Testen**, um den Schlüssel und das Modell zu prüfen. Die Unterstützung für Werkzeuge und Bilder wird angezeigt, wenn sie im Katalog oder in der Modelldokumentation angegeben ist. Prüfe die Limits und den Modellzugriff für dein Konto.

Siehe die Modelllisten für [Fireworks AI](https://fireworks.ai/models), [Together AI](https://docs.together.ai/docs/serverless/models), [Groq](https://console.groq.com/docs/models) und [Cerebras](https://inference-docs.cerebras.ai/models/overview).

## Hugging Face Inference Providers, NVIDIA NIM und Vercel AI Gateway

1. Wähle unter **Verbindung hinzufügen** den Dienst aus und gib seinen Schlüssel ein. Hugging Face benötigt ein Zugriffstoken mit der Berechtigung für Inference Providers. NVIDIA NIM benötigt einen Schlüssel mit Zugriff auf die NVIDIA Public API Endpoints. Vercel benötigt einen AI-Gateway-Schlüssel.
2. Wähle **Modelle suchen** und dann ein Modell aus. Bei Modellen mit eingeschränktem oder kontospezifischem Zugriff kannst du die vollständige Modell-ID und die Modellgrenzen eingeben. Behalte das Präfix und die Schrägstriche bei. Wenn du bei Hugging Face einen nachgelagerten Anbieter ausdrücklich auswählst, behalte auch den Suffix wie in `owner/model:novita` bei.
3. Speichere die Verbindung und wähle **Testen**, um das Modell mit deinem Schlüssel zu prüfen. Ein Katalogeintrag garantiert keinen Zugriff. Prüfe bei einem Zugriffsfehler die genaue Modell-ID und deine Berechtigung oder deinen Tarif beim Dienst, bevor du die Verbindung änderst.

VERA sendet Anfragen an den in der Modellauswahl genannten Dienst. [Hugging Face](https://huggingface.co/docs/inference-providers/index) und [Vercel](https://vercel.com/docs/ai-gateway/models-and-providers) leiten die Anfragen weiter. [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) führt das ausgewählte gehostete Modell aus. Die Modellauswahl zeigt dokumentierte Eingabetypen und Werkzeugunterstützung an.

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

Im Nachrichtenfeld erscheint eine Warnung, wenn das aktuelle Modell nur die Bildpfade erhält.

VERA liest die Bildunterstützung aus den Modellkatalogen von ChatGPT und der OpenAI-API. Für LM Studio, Ollama oder einen anderen kompatiblen Endpunkt das Modell auswählen oder eingeben. Wenn es Bilder verarbeiten kann, **Akzeptiert Bilder** einschalten und **Speichern** wählen. Die Option ist für jedes Modell zunächst ausgeschaltet.

Wenn der Anbieter auf einem entfernten Rechner läuft, verlässt das Bild beim Senden Ihren Computer. Die Textmaskierung erfasst die Bildpfade gemäß Ihren Einstellungen. Das Modell erhält die Bildpixel direkt.

## Eine Verbindung testen

**Testen** führt vier Prüfungen aus: **Erreichbarkeit**, **Authentifizierung und Modell**, **Werkzeugaufrufe** und **Streaming**. Jede zeigt **Bestanden**, **Fehlgeschlagen** oder **Übersprungen**. Der Agent verwendet Werkzeugaufrufe, um Dokumente zu durchsuchen, Dateien zu lesen und zu ändern und Programme auszuführen; wählen Sie daher ein Modell, das **Werkzeugaufrufe** besteht.

## Schlüssel und sichere Speicherung

Schlüssel werden mit dem sicheren Speicher Ihres Betriebssystems verschlüsselt gespeichert. Ist dieser nicht verfügbar, lässt VERA Sie wählen: **Nur für diesen Lauf verwenden** hält den Schlüssel im Arbeitsspeicher, bis VERA beendet wird; **Ohne sichere Verschlüsselung speichern** speichert ihn in einer Datei, die jeder mit Zugriff auf Ihr Konto lesen kann. Um einen Schlüssel zu ersetzen, geben Sie einen neuen ein; um ihn zu entfernen, verwenden Sie **Gespeicherten Schlüssel entfernen**. **Entfernen** löscht eine Verbindung.

## Ein Modell wählen

- Für eine Sitzung: Wählen Sie das **Modell** neben dem Nachrichtenfeld.
- Für einen Workbench: **Workbench bearbeiten** → **Agent und Chat** → **Standardmodell**, geschrieben als `provider/model`. Lassen Sie das Feld leer, um den Standard der Anwendung zu verwenden.

Die Auswahl in der Sitzung hat Vorrang vor dem Standard des Workbenchs und dieser vor dem Standard der Anwendung.

Die Modellauswahl zeigt Anbieter, Kontextlimit, Eingabetypen und bekannte Informationen zu Werkzeugen und Schlussfolgern. **Werkzeuge ungeprüft** bedeutet, dass Werkzeugaufrufe für das Modell noch nicht bestätigt sind.

## Häufige Fehler

| Meldung | Was zu tun ist |
|---|---|
| **Authentifizierung fehlgeschlagen. Gespeicherte Zugangsdaten in den Anbietereinstellungen prüfen.** | Geben Sie den Schlüssel erneut ein oder melden Sie sich erneut an |
| **Anbieterlimit erreicht.** | Warten Sie die angezeigte Zeit ab und versuchen Sie es dann erneut |
| **Der Anbieter hat die Kontextgröße abgelehnt.** | Kürzen Sie die Eingabe oder korrigieren Sie **Kontextfenster (Tokens)** |
| **… ist nicht erreichbar** | Starten Sie den lokalen Server oder prüfen Sie das Netzwerk und die **Basis-URL** |

Siehe auch [Fehlerbehebung](troubleshooting.md).
