# Depanare GDB

Depanarea GDB îi permite agentului să depaneze firmware Cortex-M cu simboluri, fără o consolă de debugger. Offline, inspectează un ELF de firmware. Printr-un probe declarat, rulează pentru fiecare apel o singură sesiune finită și supravegheată: un snapshot al registrelor, al backtrace-ului, al variabilelor locale, al variabilelor din RAM și al stării de fault decodate, un breakpoint hardware cu timeout sau un pas cu pas limitat. Simbolurile sunt afișate doar când ELF-ul corespunde flash-ului țintei. Rezultatele ajung în `embedded-lab-results/<run-id>/` din workbench.

## Ce necesită

- **arm-none-eabi-gdb** 12 sau mai nou și **OpenOCD** 0.12.0 sau mai nou, pe care le instalezi singur (de exemplu build-urile xPack sau `gdb-multiarch` și `openocd` pe Ubuntu); apoi folosește **Verifică dependențele** pe pagina pluginului. Driverele pentru probe și permisiunile USB le configurezi tu.
- **gdb-elf** și **gdb-debug**: scripturi instalate automat.
- Pentru sesiunile live, un probe de depanare declarat în `lab/resources.json` (parametrul `lab-resources`, opțional) prin VID, PID și numărul de serie USB, cu un profil: `stm32f4-stlink` (Cortex-M4F) sau `stm32g0-stlink` (Cortex-M0+). Secțiunea **Configurare** de pe pagina pluginului îi arată starea.
- ELF-ul exact al imaginii de pe placă.

## Cum se folosește

- „Inspectează build/app.elf: arhitectură, simboluri și informații de depanare.” (skill-ul `debug-sessions`)
- „Placa de pe stlink1 s-a blocat. Fă un snapshot cu build/app.elf, ține nucleul oprit și decodează fault-ul.”
- „Citește variabilele counter și state.mode în același snapshot.”
- „Rulează până se ajunge la funcția sample, cu un timeout de 30 de secunde.”
- „Avansează trei linii de cod sursă de aici.”

Înainte de o sesiune live, agentul întreabă ce acționează firmware-ul (relee, motoare, încălzitoare) și, la ieșire, lasă nucleul să ruleze din nou doar cu acordul tău, în cazul unui firmware care acționează ceva. Când ELF-ul nu corespunde flash-ului, raportează simbolurile ca necunoscute în loc să ghicească.

## Risc și aprobări

- Sigur, rulează fără să întrebe: inspecția și diagnosticarea ELF, versiunile instrumentelor și curățarea `release`.
- Scriere dispozitiv: `snapshot`, `break` și `step`. Fiecare oprește nucleul prin probe, iar `break` și `step` rulează firmware; la final se aplică politica de ieșire aleasă (oprit sau reluare). Nu se scrie nimic în memorie sau în flash. Modurile Întreabă și Editare automată cer aprobarea înaintea fiecăreia.
- Ireversibil: orice sesiune cu `--firmware-effect actuates`, pentru firmware care acționează elemente de execuție: oprirea lui poate lăsa o ieșire în ultima stare, iar rularea lui îl lasă să acționeze asupra hardware-ului. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.
- Blocat: apelarea directă a GDB sau OpenOCD.

## Limitări

- Windows x64 și Linux x64. Încă nerulat cu un probe și o placă reale; ambele profiluri sunt neverificate.
- Fără suport RTOS, registre de periferice, scrieri în memorie, semihosting, SWO/ITM sau continue independent. Memoria se citește doar ca variabile cu nume, cadrul salvat pe stivă și registrele de fault.
- Referințe: https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI.html și https://openocd.org/doc/html/GDB-and-OpenOCD.html
