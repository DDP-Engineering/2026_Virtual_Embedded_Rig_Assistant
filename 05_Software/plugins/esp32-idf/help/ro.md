# ESP32 ESP-IDF

ESP32 ESP-IDF îi permite agentului să compileze și să repare proiecte ESP-IDF, să raporteze dimensiunile firmware-ului, să programeze rezultatul pe o placă și să analizeze panicile ESP32: decodează backtrace-urile Guru Meditation în linii de cod sursă cu ELF-ul corespunzător și citește core dump-urile de pe cip. Folosește ESP-IDF-ul pe care l-ai instalat și selectat singur.

## Ce necesită

- **ESP-IDF 5.4 sau mai nou (sub 7)**, instalat cu ESP-IDF Installation Manager (EIM). VERA găsește `idf.py` prin EIM, dar nu îl instalează niciodată. Instalează ESP-IDF cu EIM, selectează versiunea cu `eim select`, pune `eim` în PATH, pornește VERA, apoi folosește **Verifică dependențele** pe pagina pluginului. Ghid: https://docs.espressif.com/projects/idf-im-ui/en/latest/
- Decodoarele `addr2line` pentru Xtensa și RISC-V din toolchain-urile ESP-IDF, instalate tot cu EIM. Pentru un folder rădăcină de instrumente personalizat, pornește VERA cu `IDF_TOOLS_PATH` setat la acel folder.
- Driverele USB pentru placa ta, instalate de tine.
- Pluginul **serial-monitor**, care găsește portul plăcii și capturează consola. **Instalează cu dependențe** îl adaugă.
- Fără parametri de configurare.

## Cum se folosește

- „Compilează proiectul din firmware/ și repară prima eroare de compilare.” (skill-ul `esp32-build-fix`)
- „Activează core dump în flash în sdkconfig.defaults, reconfigurează și recompilează.”
- „Ce componente ocupă cel mai mult flash?”
- „Programează build-ul pe placa de pe COM5.”
- „Placa a dat crash cu un Guru Meditation. Capturează-l pe COM5 și decodează backtrace-ul cu ELF-ul programat.” (skill-ul `esp32-panic`)
- „Citește core dump-ul de pe placa de pe COM5.”

Agentul nu editează niciodată `sdkconfig` generat; modifică `sdkconfig.defaults`, reconfigurează și verifică configurația efectivă. Decodează un backtrace doar cu ELF-ul exact al build-ului programat și spune asta atunci când potrivirea nu este cunoscută.

## Risc și aprobări

- Sigur, rulează fără să întrebe: build, rapoarte de dimensiune, `set-target`, `fullclean`, `reconfigure` și decodoarele addr2line. `set-target` și `fullclean` șterg ieșirea de build generată.
- Citire dispozitiv: `coredump-info`, care citește partiția de core dump și poate reseta placa.
- Scriere dispozitiv: `flash`, `app-flash`, `erase-flash` și `erase-otadata`, care suprascriu firmware sau date pe cip; ștergerea datelor OTA schimbă aplicația selectată.
- Ireversibil: comenzile `efuse-*` și `secure-*`, care pot modifica permanent cipul. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass. O reparare de build nu are niciodată nevoie de ele.
- Blocat: `monitor`, `menuconfig`, `gdb` și `gdbtui`, care sunt interactive, inclusiv `flash monitor`. Folosește monitorul serial pentru captura consolei.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei comenzi de citire dispozitiv și de scriere dispozitiv; Editare automată rulează comenzile de citire dispozitiv fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- Transportul comenzilor prin EIM este verificat cu EIM 0.20.1. Un build ESP-IDF real, o programare și o decodare de panică pe hardware nu sunt încă dovedite.
- Referințe: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-py.html și https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html
