# Build-uri, teste și programare Zephyr

Acest plugin îi permite agentului să compileze aplicații Zephyr RTOS pentru o placă exactă, să compileze scenarii de test Twister și să programeze o placă prin operații verificate. Agentul scrie o cerere explicită: workspace-ul west cu fiecare proiect la revizia lui fixată, folderul SDK, aplicația, placa, fișierele de configurare și propriul lui folder de build. Build-urile păstrează fișierele de firmware cu hash-uri, configurația, devicetree-ul și map-ul. Proiectele nelistate, comenzile de extensie și hook-urile de build sunt refuzate dacă nu le aprobi după hash. Rezultatele ajung în `embedded-lab-results/`.

## Ce necesită

- **Două helpere Python** cu west 1.5.0, CMake 4.4.4 și Ninja 1.13.2 fixate, pe care VERA le instalează singură cu **Instalează dependențele**.
- **Un Zephyr SDK 1.0.1 sau mai nou**, pe care îl instalezi singur, cu toolchain-ul GNU al plăcii tale în folderul `gnu/`.
- **Un workspace west** cu Zephyr 4.4 sau 4.5, configurat de tine sau de agent într-un pas de rețea aprobat separat. Pe Windows, păstrează căile scurte.
- Pentru programare: **STM32CubeProgrammer**, pe care îl instalezi singur de la https://www.st.com/en/development-tools/stm32cubeprog.html (este necesar un cont ST), un probe ST-LINK și registrul de laborator `lab/resources.json`, care declară probe-ul prin alias (opțional; nu este necesar pentru build-uri și teste). Secțiunea **Configurare** de pe pagina pluginului arată dacă este prezent și valid.

## Cum se folosește

Agentul folosește skill-ul `zephyr-builds`. Nu editează niciodată fișiere `.conf`, overlay sau Kconfig ca să treacă un build.

- „Inspectează workspace-ul D:/zw pentru apps/blinky pe stm32f4_disco.”
- „Compilează blinky și raportează utilizarea memoriei.”
- „Compilează scenariul Twister foo.basic și rulează-l pe placa Renode STM32F4 Discovery.”
- „Programează ultimul build prin probe-ul stlink1; firmware-ul nu acționează niciun element de execuție.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): inspectarea, raportarea artefactelor, evaluarea rulărilor de test și listarea diferențelor; fără build, cod de proiect sau rețea.
- **Scriere dispozitiv** (întreabă în modurile **Întreabă** și **Editare automată**): compilarea și compilarea testelor, pentru că pe computerul tău rulează cod din workspace și din aplicație (o aprobare nu este un sandbox); curățarea folderului de build; pregătirea workspace-ului, singurul pas de rețea; și programarea, care suprascrie flash-ul țintei.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): programarea unui firmware care acționează elemente de execuție odată ce pornește. În **Bypass — acces complet** aceasta rulează fără să întrebe.
- **Blocat**: apelarea directă a STM32_Programmer_CLI; folosește operația de programare sau pluginul stm32-cubeprog.

## Limitări

- Windows x64 și Linux x64. Verificat cu Zephyr 4.4.2, SDK 1.0.1 și `stm32f4_disco` pe Windows x64; Ubuntu nativ și o placă reală nu sunt încă verificate.
- Programarea suportă doar runner-ul `stm32cubeprogrammer`. Depanarea live ține de pluginul gdb-debug.
- Twister rulează doar build-uri; un rezultat doar de build nu este niciodată o trecere.
