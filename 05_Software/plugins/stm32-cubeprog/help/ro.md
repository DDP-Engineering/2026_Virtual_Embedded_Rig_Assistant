# STM32CubeProgrammer

Acest plugin îi permite agentului să programeze componente STM32 cu propriul tău STM32CubeProgrammer (STM32_Programmer_CLI). Se conectează printr-un ST-LINK sau printr-un bootloader UART, USB DFU, SPI, I2C ori CAN, citește memorii, programează și verifică imagini, șterge, resetează și citește sau modifică option bytes. Folosește-l pentru a programa o placă STM32 sau pentru a-i inspecta starea de protecție.

## Ce necesită

- **STM32CubeProgrammer**, pe care îl instalezi singur de la https://www.st.com/en/development-tools/stm32cubeprog.html (este necesar un cont ST), sau STM32CubeIDE, care îl include. VERA nu îl descarcă niciodată; îl caută în folderele standard de instalare și în PATH.
- Pe Linux, o instalare personalizată are nevoie de o legătură `stm32_programmer_cli` cu litere mici în PATH.
- Un probe ST-LINK sau o conexiune prin bootloader și placa țintă. Pe Windows, programul de instalare adaugă driverele ST-LINK; pe Linux instalezi singur regulile udev de la ST.
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `stm32-flash` și `stm32-option-bytes`. Stabilește cu tine probe-ul și interfața înainte să se conecteze.

- „Listează probe-urile ST-LINK conectate.”
- „Conectează-te prin SWD și spune-mi ID-ul dispozitivului și dimensiunea flash-ului.”
- „Programează build/app.elf prin SWD, verifică-l și resetează placa.”
- „Citește 4 KB de flash de la 0x08000000 în captures/flash.bin.”
- „Arată option bytes și explică fiecare câmp.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): ajutorul, versiunea, setările de ieșire, instrumentele pentru fișiere de pe gazdă și listarea probe-urilor fără conectare.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): conectarea, citirea, verificarea, reseturile, halt/run/step și afișarea option bytes, a OTP-ului sau a stării produsului. Reseturile afectează programul care rulează.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): scrierea, ștergerea sau umplerea flash-ului ori a RAM-ului, rularea de cod, scrierea registrelor nucleului și modificările stivei wireless; de asemenea, comenzile necunoscute. O imagine hex, srec sau ELF poate conține segmente de option bytes sau OTP, pe care o scriere le programează și pe ele.
- **Ireversibil** (întreabă, iar tu tastezi comanda, de exemplu `-ob`): scrierea option bytes, regresia protecției la citire și a TrustZone (ștergere completă), blocarea și deblocarea RDP, OTP, chei, firmware securizat, starea produsului, autentificarea pentru depanare, licențe HSM și comutarea alimentării țintei. Nivelul RDP 1 se elimină doar printr-o ștergere completă; nivelul RDP 2 este permanent și blochează pentru totdeauna accesul de depanare, așa că o scriere de option bytes care îl setează îți cere să tastezi `RDP=0xCC`. În **Bypass — acces complet** acestea rulează fără să întrebe.
- **Blocat**: fișierele de script, pentru că VERA nu poate clasifica comenzile pe care le conțin.

## Limitări

- Windows x64 și Linux x64. Regulile au fost măsurate pe STM32CubeProgrammer 2.23.0; comenzile din versiunile ulterioare contează ca necunoscute până când regulile le listează.
- Fișierele pe care CLI-ul le scrie pe computerul tău (citiri de memorie, loguri, dump-uri de registre) nu necesită aprobare separată.
- Pluginul nu s-a conectat încă la o placă reală și nu a modificat încă option bytes.
