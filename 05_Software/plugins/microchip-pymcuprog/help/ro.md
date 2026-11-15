# Microchip pymcuprog (AVR, PIC)

Acest plugin îi permite agentului să identifice, să programeze, să verifice și să șteargă componente Microchip AVR (UPDI) și PIC cu pymcuprog, să le citească înapoi memoriile și să citească sau să modifice fuse-urile și cuvintele de configurare. Lucrează printr-un kit Curiosity Nano sau Xplained cu nEDBG, un PICkit 4 sau MPLAB Snap în mod AVR, un Atmel-ICE sau un adaptor SerialUPDI.

## Ce necesită

- **pymcuprog 3.19** (sub 4), un pachet Python pe care VERA îl instalează singură cu **Instalează dependențele**.
- Un programator sau kit suportat și placa țintă. Un adaptor SerialUPDI este orice adaptor serial USB cu un rezistor între RX, TX și UPDI.
- Pe Windows, instrumentele USB nu au nevoie de driver suplimentar. Pe Linux poate fi nevoie de regulile udev din README-ul pymcuprog (https://github.com/microchip-pic-avr-tools/pymcuprog) pentru accesul la nEDBG, PICkit și Atmel-ICE.
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `microchip-flash` și `microchip-fuses`. Spune-i ce instrument și ce dispozitiv folosești; nu le ghicește.

- „Fă ping la ATtiny416 de pe adaptorul SerialUPDI de pe COM5.”
- „Scrie build/app.hex în ATtiny416, cu ștergere înainte și verificare.”
- „Citește primii 64 de octeți din flash și salvează EEPROM-ul în captures/eeprom.hex.”
- „Citește fuse-urile ATtiny416, salvează-le ca înregistrare și explică fiecare octet.”
- „Setează fuse-ul 2 (OSCCFG) la 0x01, apoi citește din nou fuse-urile și compară.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): ajutorul, informațiile despre versiune și release și conversia unui fișier hex în UF2.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): ping, citire, verificare, reset și citiri de tensiune.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): scrierea flash-ului, a EEPROM-ului sau a user row, ștergerea cipului, repornirea debuggerului și ștergerea sau scrierea unei componente UPDI blocate. Un argument pe care pymcuprog l-ar respinge este tratat tot ca scriere dispozitiv.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare `write` sau `erase` afișat pe card): orice scriere a unui fișier hex, pentru că un fișier Intel hex poate conține date de fuse-uri, cuvinte de configurare și biți de blocare; orice scriere sau ștergere de fuse-uri, cuvinte de configurare sau biți de blocare; modificarea tensiunii de alimentare a kitului; orice comandă cu tensiune înaltă UPDI (12 V, `-H`). Un fuse greșit poate dezactiva UPDI sau resetul, iar biții de blocare activează protecția codului. În **Bypass — acces complet** acestea rulează fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- pymcuprog 3.19 nu poate folosi un PICkit 5.
- Fișierele pe care o citire în fișier sau o conversie UF2 le scrie pe computerul tău nu se aprobă separat.
- Pluginul nu a fost încă testat cu un instrument sau o placă reale.
