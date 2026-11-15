# Instrumente MQTT (telemetrie și comenzi)

Acest plugin îi permite agentului să captureze telemetrie MQTT și să trimită comenzi controlate către dispozitive, pe un broker configurat de workbenchul tău. Capturile sunt limitate în timp, număr de mesaje și octeți și păstrează fiecare payload brut cu flag-urile lui. Un mesaj ajunge doar la un topic declarat de profilul brokerului, este trimis o singură dată și nu se reîncearcă niciodată, iar o comandă nu este niciodată reținută (retained). Sunt suportate MQTT 5 și 3.1.1; nu există administrare de broker. Rezultatele ajung în `arduino-iot-results/`.

## Ce necesită

- **mqtt-tool**, un script Python din plugin fixat pe paho-mqtt 2.1.0, pe care VERA îl instalează singură cu **Instalează dependențele**.
- Un **profil de broker**: un fișier JSON din workbench care declară brokerul, încrederea TLS, referința credențialei, protocolul, topicurile la care se poate abona o captură și în care poate publica o rulare, limitele, schemele payload-urilor și un Last Will de stare opțional.
- **Credențiala brokerului** (`broker-credential`): un nume de utilizator și o parolă stocate sub referința pe care o numește profilul, de exemplu `bench`. Seteaz-o în secțiunea **Configurare** de pe pagina pluginului. Rămâne în depozitul de credențiale al VERA și ajunge doar la o rulare aprobată a acestui plugin; nu o lipi niciodată în chat.

## Cum se folosește

Agentul folosește skill-urile `mqtt-telemetry` și `mqtt-commands`.

- „Verifică profilul de broker mqtt/bench.json și testează conexiunea cu credențiala bench.”
- „Capturează vera-test/bench1/telemetry/# timp de 30 de secunde și numără mesajele noi.”
- „Publică online în topicul de stare vera-test/bench1/status/vera.”
- „Trimite comanda LED {"on":true} și așteaptă răspunsul dispozitivului.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): descrierea clientului și verificarea offline a unui profil.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): un test de conexiune și o captură limitată. Nu se publică nimic, cu excepția Last Will-ului de stare dacă conexiunea se încheie anormal.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): publicarea unui mesaj sau trimiterea unei cereri; o comandă poate face un dispozitiv să acționeze. Butonul Oprește nu poate retrage un mesaj trimis.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): publicarea unui mesaj reținut (retained), pe care brokerul îl păstrează și îl livrează fiecărui abonat ulterior până când este înlocuit. În **Bypass — acces complet** aceasta rulează fără să întrebe.

Înainte să aprobi o rulare care numește o credențială, verifică hostul brokerului din profil: credențiala ajunge la acel broker.

## Limitări

- Windows x64 și Linux x64.
- QoS 2 nu este suportat. Un mesaj QoS 1 poate ajunge de două ori la dispozitiv prin relivrarea brokerului.
- Dacă conexiunea se pierde înainte de confirmare, livrarea este raportată ca necunoscută.
- Pluginul nu a rulat încă pe un broker de producție sau cu un dispozitiv real.
