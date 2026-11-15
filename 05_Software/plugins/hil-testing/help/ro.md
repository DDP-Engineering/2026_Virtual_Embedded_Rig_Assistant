# Testare HIL

Testarea HIL rulează planuri de test hardware-in-the-loop finite pe o placă reală. Un plan este un fișier JSON, niciodată un script: pregătirea, firmware-ul și SHA-256 al lui, cablajul, efectul firmware-ului asupra lumii exterioare, pașii, un buget de timp și curățarea. VERA compilează fiecare pas într-o operație a altui plugin activat, cere o singură aprobare pentru întregul plan, rezervă probe-ul, porturile seriale și instrumentele și rulează pașii. Curățarea rulează întotdeauna, inclusiv după apăsarea butonului Oprește sau după un timeout. Rezultatele și rapoartele (JSON, JUnit, HTML, Markdown) ajung în `embedded-lab-results/<run-id>/` din workbench.

## Ce necesită

- **hil**: un script din plugin, instalat automat de **Instalează dependențele** de pe pagina pluginului.
- Pluginurile ale căror operații le folosește planul, activate în workbench: probe-rs, esp32-esptool, serial-monitor, scpi-instruments și lab-validation.
- Placa cu probe-ul sau portul ei serial și instrumentele declarate în `lab/resources.json`, când planul le numește prin alias.
- Fișierul de firmware de testat; planul îi înregistrează SHA-256.

## Cum se folosește

- „Scrie un smoke test HIL pentru build-ul blinky pe NUCLEO-F401RE: programare, reset, așteptare READY, trimitere ping și verificarea frecvenței de clipire a LED-ului cu osciloscopul.” (skill-ul `hil-planning`)
- „Verifică planul hil/blinky.json și arată-mi fiecare operație și riscul ei.”
- „Rulează hil/blinky.json în fundal.”
- „De ce a eșuat planul? Arată pasul care a eșuat și logul lui.”

Înainte de a scrie un plan, agentul te întreabă ce acționează firmware-ul (relee, motoare, încălzitoare, ieșiri) și, dacă are dubii, nu alege niciodată un efect mai mic. `hil check` nu atinge hardware și îți arată expansiunea completă pentru verificare.

## Risc și aprobări

- Sigur, rulează fără să întrebe: `hil check` și `hil report`.
- `hil run`: o singură aprobare pentru întregul plan, la cel mai mare risc dintre operațiile lui, așa cum le evaluează celelalte pluginuri, și dintre efectul declarat al firmware-ului când planul programează sau resetează; niciodată mai jos de citire dispozitiv. Un plan ireversibil îți cere să tastezi ID-ul planului. Un plan, un firmware sau un registru modificat după aprobare este refuzat.
- Pașii de programare, reset, ieșire și configurare rulează o singură dată; nu pot fi reîncercați sau repetați.

Dacă o rulare se încheie cu starea fizică `unknown`, nu se știe dacă laboratorul este în siguranță; agentul îți spune asta mai întâi.

## Limitări

- Windows x64 și Linux x64. Testat pe Windows doar cu înlocuitori; Ubuntu nativ și o placă reală nu au fost încă rulate.
- Pașii rulează pe rând, cu excepția capturilor UART în fundal și a menținerilor de alimentare. Pornește o captură a logului de pornire în fundal înainte de reset, altfel logul se pierde.
- VERA nu poate bloca programele din afara VERA.
- Pașii GDB, Zephyr, PlatformIO și Twister nu sunt disponibili.
