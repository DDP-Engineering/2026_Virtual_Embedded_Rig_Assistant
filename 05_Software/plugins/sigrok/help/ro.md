# sigrok (fork DDP)

Acest plugin îi permite agentului să captureze și să decodeze semnale digitale și analogice și să citească sau să configureze instrumente de laborator prin sigrok-cli. Capturile sunt limitate și salvate ca fișiere srzip în workbench; capturile salvate pot fi decodate offline cu decodoare UART, I2C, SPI, CAN, 1-Wire și, în fork-ul DDP, cu o stivă de decodoare Ethernet. Fork-ul DDP al sigrok adaugă drivere pentru analizorul logic ATK-DL16 și osciloscopul cu semnal mixt Hantek DSO-3062L.

## Ce necesită

- **sigrok-cli.** **Instalează dependențele** oferă un pachet al fork-ului DDP fixat prin SHA-256 pentru platforma curentă; acesta are prioritate față de o copie locală. Până când este instalat, VERA folosește un sigrok-cli din PATH (pe Linux și `/usr/bin/sigrok-cli`). Un sigrok-cli upstream poate decoda protocoale și poate folosi dispozitivele pe care le listează, dar nu are driverele fork-ului.
- **Un instrument suportat** și acces USB, pe care le configurezi singur. Pe Linux, instalează regulile udev ale fork-ului și ale libsigrok, intră în grupul `plugdev` și autentifică-te din nou. Pe Windows, asociază WinUSB cu Zadig la dispozitivul Hantek, ATK-DL16 sau din clasa fx2lafw, când este necesar.
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `sigrok-capture`, `sigrok-decode`, `sigrok-instruments`, `atk-dl16` și `hantek-dso3062l`. Verifică ce drivere are sigrok-cli instalat și nu ghicește niciodată o conexiune.

- „Capturează 100 000 de eșantioane de pe D0–D2 cu ATK-DL16 la 10 MHz în captures/logic.sr.”
- „Declanșează pe un front crescător al D8 și capturează un buffer.”
- „Ia un singur cadru de pe Hantek DSO-3062L.”
- „Decodează UART-ul de pe D0 la 115200 baud din captures/logic.sr.”
- „Citește tensiunea sursei Korad de pe COM3.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): ajutorul, versiunea, listele de elemente suportate și decodarea unei capturi salvate.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): scanarea, listarea porturilor seriale, afișarea unui driver, citirea valorilor și capturile limitate cu un driver explicit.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): modificarea setărilor instrumentelor, inclusiv o citire care aplică mai întâi setări.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): modificarea setărilor surselor de alimentare, sarcinilor electronice, generatoarelor de semnal, releelor și instrumentelor similare care acționează ieșiri, orice setare fără un driver explicit și ieșirea generatorului PWM al ATK-DL16. În **Bypass — acces complet** acestea rulează fără să întrebe.

## Limitări

- Windows x64, Linux x64 și Linux ARM64.
- Pachetele fixate indică o versiune privată care nu este încă publicată; până atunci, folosește un sigrok-cli din PATH.
- Un șir de versiune local nu dovedește că driverele fork-ului sunt prezente; agentul verifică singur existența `atk-dl16` și `hantek-dso3062l`.
- Un trigger care nu se declanșează niciodată poate da zero eșantioane și niciun fișier.
