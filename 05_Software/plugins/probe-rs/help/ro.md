# probe-rs

Acest plugin îi permite agentului să lucreze cu un probe de depanare conectat la computerul tău, prin probe-rs 0.32.0. Identifică probe-uri și ținte, programează și verifică ELF-ul exact al build-ului, resetează ținta, citește memoria și registrele perifericelor și transmite loguri RTT în fundal pe ținte ARM, RISC-V și Xtensa suportate (de exemplu `esp32`, `esp32s3`, `esp32c3`).

## Ce necesită

- **probe-rs 0.32.0.** VERA caută mai întâi în PATH și în `~/.cargo/bin`; dacă nu găsește nimic, **Instalează dependențele** descarcă versiunea portabilă fixată în folderul de programe al VERA. O copie găsită cu altă versiune este raportată ca indisponibilă: corectează mai întâi PATH-ul sau acea instalare.
- **Un probe de depanare și o placă țintă**, cu drivere și acces la dispozitiv pe care le configurezi singur. Pe Linux, aceasta înseamnă regula udev probe-rs și apartenența la `plugdev`. Pe Windows, ST-Link folosește driverul STSW-LINK009 de la ST, J-Link și FTDI au nevoie de WinUSB, iar CMSIS-DAP de obicei nu are nevoie de nimic în plus. VERA nu instalează niciodată drivere sau reguli. Ghid de configurare: https://probe.rs/docs/getting-started/probe-setup/
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt` și `probe-rs-inspect`. Numește întotdeauna probe-ul și cipul pe care le-a observat și nu le ghicește niciodată dintr-un exemplu.

- „Listează probe-urile de depanare conectate și identifică ținta de pe ST-Link.”
- „Programează build/app.elf în STM32, verifică-l și resetează ținta.”
- „Conectează-te la țintă și urmărește logul RTT până afișează 'ready', apoi oprește-te.”
- „Citește registrul RCC_CR al STM32F4 și decodează-i câmpurile.”
- „Firmware-ul a dat un HardFault: asociază PC-ul și LR-ul salvate pe stivă cu liniile de cod sursă.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): ajutorul, versiunea, lista de ținte și listarea probe-urilor; acestea nu se conectează la o țintă.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): info, read, verify, attach, profile și trace pot opri ținta pentru scurt timp; reset o repornește fără să modifice firmware-ul.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): download, run, erase și benchmark suprascriu flash-ul sau RAM-ul; itm configurează hardware-ul de trace. Aprobarea este legată de hash-ul ELF-ului.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare `write`): scrierea arbitrară în memorie, pentru că o scriere într-un controler de flash sau într-un registru de opțiuni poate activa protecția permanentă la citire, iar o scriere într-un registru GPIO acționează pini. În **Bypass — acces complet** aceasta rulează fără să întrebe.
- **Blocat**: depanarea interactivă, serverele GDB și DAP, completarea în shell și probe-urile la distanță (`--host`).

## Limitări

- Windows x64, Linux x64 și Linux ARM64.
- Intrarea RTT nu este suportată; firmware-ul cu canale RTT descendente nu este încă verificat în laborator.
- Pluginul nu a fost încă verificat cu un probe și o placă reale.
