# Monitor serial

Acest plugin îi permite agentului să listeze porturile seriale ale computerului tău cu ID-urile USB, numerele de serie și familia plăcii, să captureze consola unei plăci (opțional după un reset prin DTR/RTS) și să trimită plăcii o linie. Folosește-l ca să afli ce port folosește o placă și ca să-i citești logul de pornire sau ieșirea din consolă.

## Ce necesită

- **serial**, un script Python din plugin bazat pe pyserial 3.5, pe care VERA îl instalează singură cu **Instalează dependențele**.
- O placă conectată prin USB serial.
- Pe Linux, utilizatorul tău trebuie să facă parte din grupul care deține porturile seriale: `dialout` (Debian, Ubuntu, Fedora) sau `uucp` (Arch). Agentul îți arată comanda, dar o rulezi tu și te autentifici din nou.
- Fără alte pluginuri și fără configurare. Pentru a confirma tipul unui cip ESP32, te ajută pluginul esp32-esptool.

## Cum se folosește

Agentul folosește skill-urile `serial-console` și `esp32-identify`. Listează porturile înainte de a folosi unul și nu ghicește niciodată numele unui port; pe Linux preferă calea stabilă `/dev/serial/by-id/...`.

- „Ce plăci sunt conectate și pe ce porturi?”
- „Capturează consola plăcii de pe COM5 timp de 10 secunde.”
- „Resetează ESP32 de pe COM7 și capturează logul de pornire până când este apelat app_main.”
- „Trimite help plăcii de pe COM5 și arată răspunsul.”
- „Urmărește în fundal consola plăcii de pe /dev/ttyUSB0 până îți spun să te oprești.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): listarea porturilor, ajutorul și versiunea.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): captura consolei. Simpla deschidere a portului nu repornește placa; cu reset, aceasta repornește prin DTR/RTS.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): trimiterea unei linii. Firmware-ul plăcii decide ce face linia, așa că agentul trimite doar ce i-ai cerut.

Cât timp o captură în fundal ține un port, VERA refuză orice altă rulare pe acel port până când captura este oprită.

## Limitări

- Windows x64 și Linux x64.
- „Access is denied” pe Windows înseamnă că un alt program, de exemplu un terminal sau monitorul unui IDE, ține portul ocupat.
- Un port fără o familie recunoscută nu este neapărat placa la care te aștepți; agentul întreabă înainte să-l folosească.
- Ieșirea din consolă este tratată ca date de la dispozitiv, niciodată ca instrucțiuni.
