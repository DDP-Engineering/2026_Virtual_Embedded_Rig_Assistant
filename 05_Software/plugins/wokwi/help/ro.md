# Simulare în cloud Wokwi

Acest plugin îi permite agentului să ruleze simulări de firmware și scenarii de test finite în cloudul Wokwi, cu wokwi-cli 0.29.1 fixat. Agentul inspectează un proiect, îi validează diagrama offline, pregătește un job din copii exacte, cu lista de trimitere, contul, limitele și bugetul de timp, îl rulează o singură dată în cloud după aprobarea ta, apoi colectează rezultatul cu ieșirea serială, VCD și capturi de ecran. Rezultatele ajung în `arduino-iot-results/`. O simulare în cloud nu este un test electric și nici un test pe placa reală.

## Ce necesită

- **wokwi-cli 0.29.1**, pe care **Instalează dependențele** îl descarcă din release-ul lui de pe GitHub (https://github.com/wokwi/wokwi-cli/releases/tag/v0.29.1) și îl verifică prin SHA-256, și **wokwi-tool**, un script Python din plugin pe care VERA îl instalează singură.
- **Un token Wokwi CI** (`wokwi-token`) din dashboard-ul tău Wokwi, stocat sub o referință precum `ci`. Setează-l în secțiunea **Configurare** de pe pagina pluginului. Tokenul rămâne în depozitul de credențiale al VERA și ajunge doar la o rulare aprobată a acestui plugin; agentul nu îl vede niciodată.
- Un proiect Wokwi cu un firmware compilat (`.hex`, `.bin`, `.uf2`, `.elf` sau `flasher_args.json` ESP-IDF) și o diagramă cu exact o placă. Pluginul nu compilează niciodată.
- Nu sunt necesare hardware sau alte pluginuri.

## Cum se folosește

Agentul folosește skill-urile `wokwi-simulation` și `wokwi-scenarios`. Înainte de rularea în cloud îți arată fișierele care vor fi trimise, contul, placa și limitele de timp și te așteaptă.

- „Inspectează proiectul Wokwi din sim/blink și validează-i diagrama.”
- „Scrie un scenariu care apasă btn1 și se așteaptă ca led1 să se aprindă.”
- „Pregătește un job pentru sim/blink cu contul ci și un timeout virtual de 5 secunde, rulează-l, apoi scrie un raport.”
- „Simulează firmware-ul până afișează ready; eșuează dacă afișează panic.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): inspectarea proiectului, validarea diagramei, pregătirea unui job, colectarea rezultatelor și rapoartele. Acestea sunt offline; nu se trimite nimic, iar proiectul nu este modificat niciodată.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): rularea unui job, pentru că trimite diagrama, firmware-ul și ELF-ul către serverele Wokwi, de unde nu mai pot fi retrase, iar rularea se contorizează în planul tău Wokwi. În **Bypass — acces complet** aceasta rulează fără să întrebe.
- **Blocat**: rularea directă a wokwi-cli, pentru că ar încărca orice conține folderul proiectului și oferă un server MCP.

## Limitări

- Windows x64 și Linux x64.
- Cipurile personalizate, cardurile SD, serverele GDB și RFC 2217 sunt refuzate.
- VERA nu îți poate citi cota Wokwi. După apăsarea butonului Oprește, partea Wokwi a jobului nu este confirmată.
- Cu acest plugin nu s-a făcut încă nicio rulare live în cloud.
