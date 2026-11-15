# GNU binutils (ARM, RISC-V)

GNU binutils îi permite agentului să inspecteze fișiere ELF locale de firmware ARM și RISC-V cu `size`, `nm`, `readelf`, `objdump` și `addr2line` din toolchain-urile `arm-none-eabi-` și `riscv-none-elf-`. Compară dimensiunile secțiunilor și simbolurilor între două build-uri, explică organizarea memoriei, dezasamblează o funcție sau un interval mic de adrese și decodează adresele de crash în funcții și linii de cod sursă. Citește doar fișiere de pe acest computer și nu atinge niciodată o placă.

## Ce necesită

- Cele zece programe binutils (cinci pentru fiecare arhitectură). VERA caută mai întâi un toolchain pe care îl ai deja: PATH, STM32CubeCLT și STM32CubeIDE (ARM), PlatformIO, Arduino, Zephyr SDK și folderele xPack. Un toolchain aflat în altă locație poate fi adăugat în PATH.
- Dacă nu se găsește niciunul, **Instalează dependențele** de pe pagina pluginului descarcă toolchain-ul xPack fixat (ARM 15.2.1-1.1, RISC-V 15.2.0-1) în folderul de programe al VERA și îi verifică SHA-256. Nimic nu se instalează global.
- Fișierul ELF al exact acelui build pe care îl investighezi. O recompilare ulterioară poate da linii de cod plauzibile, dar greșite.
- Fără pluginuri necesare, hardware sau configurare. Fișierele ELF și toolchain-urile Espressif țin de pluginul esp32-idf.

## Cum se folosește

- „Compară build/v1.2/app.elf cu build/v1.3/app.elf și spune-mi care simboluri au crescut cel mai mult.” (skill-ul `firmware-size`)
- „De unde vin cei 2 KB de RAM în plus din noul build?”
- „Decodează acest HardFault: PC 0x08001a3c, LR 0x08001a11, folosind build/app.elf.” (skill-ul `crash-decode`)
- „Arată secțiunile și segmentele de încărcare din firmware.elf și verifică-le față de scriptul de linker.” (skill-ul `elf-inspect`)
- „Dezasamblează funcția `uart_rx_handler` împreună cu codul ei sursă.”

Agentul dezasamblează doar funcția sau intervalul de adrese investigat, niciodată întreaga imagine. Raportează `??` sau `:0` ca nerezolvat, în loc să ghicească o linie.

## Risc și aprobări

Fiecare comandă a acestui plugin este evaluată ca sigură: programele analizează fișiere de pe gazdă și nu accesează niciodată hardware, așa că rulează fără să întrebe în orice mod de permisiuni, inclusiv Doar citire. Nu există comenzi de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64, Linux x64 și Linux arm64. Arhivele pentru Linux arm64 sunt verificate, dar rularea lor nu este încă dovedită pe o gazdă arm64.
- Un binar existent a cărui versiune nu poate fi citită rămâne indisponibil; VERA nu descarcă în tăcere altul.
- Ieșirea comenzilor returnată agentului este limitată la ultimele 12.000 de caractere; ieșirea completă rămâne în logul rulării.
- Referință: https://sourceware.org/binutils/docs/binutils/
