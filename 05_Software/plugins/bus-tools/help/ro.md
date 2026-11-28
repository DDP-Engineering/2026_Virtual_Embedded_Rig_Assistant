# Instrumente de magistrală (I2C, SPI, UART)

Instrumentele de magistrală îi permit agentului să comunice cu circuitul tău prin I2C, SPI și UART, printr-un Bus Pirate 5 sau 6 în modul binar BPIO2. Identifică adaptorul, citește tensiunea de pe pinii lui, scanează o magistrală I2C după adresele care răspund, citește și scrie registre, rulează transferuri și secvențe de pași cu pauze și înregistrează un UART ca text. După fiecare apel adaptorul revine în HiZ, cu rezistențele pull-up și alimentarea oprite, dacă nu îi ceri să păstreze magistrala. Captura pasivă și decodarea rămân la pluginul sigrok. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **bus-tool**: un script instalat de **Instalează dependențele** de pe pagina pluginului.
- Un Bus Pirate 5 sau 6, trecut o dată în BPIO2 cu comanda de terminal `binmode`.
- `lab/resources.json` în workbench (parametrul `lab-resources`): o intrare `bus-adapter` cu aliasul, ambele porturi seriale (tu alegi care este cel binar) și identitatea USB; limitele de alimentare sunt opționale. Secțiunea **Configurare** de pe pagina pluginului arată dacă fișierul este valid.
- Nimic altceva pentru un prim contact: agentul scanează și comunică cu un dispozitiv folosind setările obișnuite. Un profil de magistrală în workbench este opțional; el dă nume dispozitivelor și registrelor și păstrează setările. Pluginul include exemple (BME280, flash W25Q, consolă UART).

## Cum se folosește

- „Identifică Bus Pirate-ul bp.” (skill-ul `bus-transactions`)
- „Scanează magistrala I2C și spune-mi ce dispozitive răspund.”
- „Nu răspunde nimic: verifică tensiunile de pe pinii adaptorului.”
- „Citește registrul 0xD0 al dispozitivului de la adresa 0x76.”
- „Scrie un profil de magistrală pentru BME280 la adresa 0x76.” (skill-ul `bus-profiles`)
- „Pornește o măsurătoare forțată pe BME280, așteaptă 10 ms și citește rezultatul.”
- „Înregistrează consola UART timp de 10 secunde după ce trimiți un carriage return.”

Fiecare pas se trimite o singură dată: un dispozitiv care nu confirmă, un răspuns lipsă sau o valoare neașteptată încheie rularea, iar rezultatul numește liniile magistralei care se citesc jos.

## Risc și aprobări

- Sigur, rulează fără să întrebe: listarea porturilor seriale, descrierea unui profil și rapoartele de rulare.
- Citire dispozitiv: identificarea adaptorului și citirea tensiunilor de pe pinii lui (o singură cerere de stare; pinii, pull-up-urile și alimentarea nu se schimbă).
- Scriere dispozitiv: scanarea, configurarea magistralei, citirile de registre (care scriu mai întâi adresa registrului și pot șterge flag-uri), scrierile de registre, transferurile, secvențele, captura UART și eliberarea, pentru că fiecare comandă pinii adaptorului conectați la circuitul tău. Un astfel de apel pornește și alimentarea adaptorului, ca să alimenteze circuitul, atunci când tu sau profilul o cereți.

În modurile Întreabă și Editare automată, VERA cere aprobarea înaintea fiecărei comenzi de scriere dispozitiv.

## Limitări

- Windows x64 și Linux x64. Verificat doar cu un adaptor simulat; încă fără hardware real.
- Fără acces la terminal și fără modificarea firmware-ului sau a setărilor adaptorului. Alte adaptoare (Bus Pirate v3/v4, FT232H, CH341, Aardvark) nu sunt suportate.
- O tranzacție poartă cel mult 512 octeți în fiecare sens; o captură UART durează cel mult 300 s și păstrează 1 MiB.
- Referință: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
