# MicroPython

Acest plugin îi permite agentului să lucreze cu o placă ce rulează deja MicroPython 1.22 sau mai nou. Listează porturile seriale, identifică firmware-ul plăcii, îi listează și îi citește fișierele, implementează un fișier din workbench printr-o copie temporară verificată, rulează din RAM un script din workbench cu un termen limită și un verdict de trecere/picare, capturează consola și resetează placa. Nu există REPL interactiv și nici instalare de firmware. Rezultatele ajung în `arduino-iot-results/`.

## Ce necesită

- **micropython-tool**, un script Python din plugin cu un mpremote fixat, pe care VERA îl instalează singură cu **Instalează dependențele**.
- O placă conectată prin USB serial care rulează deja MicroPython 1.22 sau mai nou. Alt firmware, inclusiv CircuitPython, este refuzat. Pentru a instala MicroPython, folosește mai întâi instrumentul producătorului plăcii (de exemplu esptool pentru un ESP32).
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `micropython-deploy` și `micropython-test-script`. Numește placa după port și după identitatea pe care o arată listarea porturilor și te întreabă ce placă se află în spatele unei punți USB-serial.

- „Listează porturile seriale și identifică placa MicroPython de pe COM5.”
- „Arată fișierele din /lib de pe placă și spațiul liber.”
- „Implementează app/sensor.py în /lib/sensor.py pe placă, apoi repornește-o.”
- „Scrie un script care scanează magistrala I2C, rulează-l pe placă cu un timeout de 30 de secunde și spune-mi verdictul.”
- „Capturează consola plăcii timp de 10 secunde după o repornire.”

## Risc și aprobări

Aproape orice operație pe placă întrerupe programul pe care îl rulează placa (Ctrl-C), așa că agentul te anunță mai întâi; cu `--restart`, programul pornește din nou după aceea.

- **Sigur** (rulează fără să întrebe): listarea porturilor fără a le deschide și rezumarea folderelor de rulare.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): identificarea plăcii, listarea și citirea fișierelor, captura consolei și resetarea plăcii, care pornește din nou programul stocat.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): implementarea unui fișier și rularea unui script din RAM. Aprobarea este legată de hash-ul fișierului. Un script poate acționa pinii plăcii și tot ce este conectat la ei.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): înlocuirea boot.py sau main.py, care rulează la fiecare pornire; unul defect poate bloca accesul la REPL până la reinstalarea firmware-ului. În **Bypass — acces complet** aceasta rulează fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- Nu există backup sau restaurare a fișierelor plăcii.
- Butonul Oprește încheie doar helperul de pe computerul tău; codul care rulează deja pe placă continuă să ruleze.
- VERA rezervă portul serial pe durata rulării.
