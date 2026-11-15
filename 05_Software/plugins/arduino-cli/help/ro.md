# Arduino CLI

Arduino CLI compilează și încarcă sketch-uri Arduino native (proiecte `.ino`) cu un arduino-cli fixat ca versiune, fără Arduino IDE. Agentul inspectează un sketch, listează plăcile conectate după identitate, caută și instalează core-uri și biblioteci în versiuni exacte, compilează o copie a sketch-ului într-un folder de rulare trasabil și încarcă exact acel binar verificat pe o placă identificată. Totul rulează în mediul Arduino propriu al VERA (`~/.vera-arduino`, `%USERPROFILE%\.vera-arduino` pe Windows); folderele Arduino IDE nu sunt niciodată citite sau modificate. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **arduino-cli** 1.6.0: pe pagina pluginului, **Instalează dependențele** îl descarcă și îi verifică SHA-256. Un arduino-cli 1.6 sau mai nou (sub 2) pe care l-ai instalat singur de la https://arduino.github.io/arduino-cli/latest/installation/ este găsit în PATH; descărcarea fixată are prioritate.
- **arduino-tool**: un script din plugin, instalat automat.
- Pluginul **serial-monitor**, care citește consola plăcii după o încărcare. **Instalează cu dependențe** îl adaugă.
- O placă Arduino conectată prin USB. Pe Linux, utilizatorul tău trebuie să facă parte din grupul care deține porturile seriale (`dialout` pe Debian, Ubuntu și Fedora).
- Fără parametri de configurare.

## Cum se folosește

- „Compilează sketch-ul Blink pentru un Arduino Uno și raportează utilizarea flash și RAM.” (skill-ul `arduino-build-fix`)
- „Compilarea spune că lipsește Adafruit_BME280.h. Găsește și instalează biblioteca potrivită.” (skill-ul `arduino-libraries`)
- „Ce plăci sunt conectate?”
- „Scrie un sketch mic care afișează citirile BME280, încarcă-l pe Uno de pe COM5 și arată-mi bannerul.” (skill-ul `arduino-test-sketch`)

Agentul te întreabă ce placă și ce port să folosească atunci când sunt conectate mai multe sau când placa se află în spatele unui cip punte USB (CH340, FTDI, CP210x). Te întreabă înainte de a instala un core sau o bibliotecă, pentru că este o descărcare. După o încărcare, citește bannerul de pornire cu monitorul serial.

## Risc și aprobări

- Sigur, rulează fără să întrebe: inspectarea unui sketch, căutările de plăci, core-uri și biblioteci, rapoartele de rulare și curățarea cache-ului de build al VERA.
- Citire dispozitiv: listarea plăcilor (porturi seriale și descoperire mDNS) și compilarea, care rulează compilatorul core-ului și hook-urile de build pe acest computer.
- Scriere dispozitiv: instalarea de core-uri, biblioteci și indexuri în mediul Arduino al VERA și încărcarea, care scrie flash-ul plăcii și pornește imediat noul firmware. Cu un programator, încărcarea suprascrie și bootloaderul.
- Blocat: orice comandă `arduino-cli` directă.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei comenzi de citire dispozitiv și de scriere dispozitiv; Editare automată rulează comenzile de citire dispozitiv fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- Fără daemon, monitor interactiv, scrierea bootloaderului, fuse-uri sau încărcare OTA.
- Un `sketch.yaml` este raportat și ignorat. Dependențele bibliotecilor nu se instalează automat; fiecare se instalează explicit, într-o versiune exactă.
