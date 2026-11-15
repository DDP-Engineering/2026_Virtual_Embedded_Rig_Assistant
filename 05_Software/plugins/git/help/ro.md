# Git

Git îi permite agentului să inspecteze și să modifice depozitul Git al workbenchului. Citește liber starea, istoricul, diferențele, blame și listele de branch-uri, tag-uri, remote-uri și stash-uri; staging-ul, commit-urile, lucrul cu branch-uri și contactarea remote-urilor așteaptă aprobarea ta. Editoarele interactive, pagerele și hook-urile sunt dezactivate, așa că fiecare comandă rulează fără prompturi.

## Ce necesită

- **Git 2.40 sau mai nou**, pe care îl instalezi singur (Git for Windows sau pachetul git al distribuției tale). VERA îl găsește în PATH, în folderele standard Git for Windows sau la `/usr/bin/git` și nu îl descarcă niciodată. După instalare, folosește **Verifică dependențele** pe pagina pluginului.
- Pentru fetch, pull, push și clone: propriile tale credențiale configurate sau chei SSH. VERA nu adaugă credențiale, iar Git nu le cere.
- Fără pluginuri necesare, hardware sau parametri de configurare.

## Cum se folosește

- „Ce s-a schimbat de la ultimul tag de lansare?” (skill-ul `git-inspect`)
- „Cine a modificat ultimul liniile 40–60 din src/main.c?”
- „Fă commit la modificările din src/uart.c și src/uart.h cu mesajul 'Fix UART overrun handling'.” (skill-ul `git-commit`)
- „Creează un branch feature/adc-calibration din main și treci pe el.” (skill-ul `git-branches`)
- „Fă merge la feature/adc-calibration în main.”

Agentul pune în staging doar căile asupra cărora ați convenit, scrie mesajul cu `commit -m` și citează hash-ul commit-ului rezultat. Nu face push decât dacă ceri, nu rescrie niciodată istoricul deja publicat și îți raportează conflictele de merge sau rebase în loc să renunțe la modificări.

## Risc și aprobări

Etichetele de risc sunt refolosite pentru starea depozitului:

- Sigur, rulează fără să întrebe: status, log, diff, show, blame, describe, grep și celelalte comenzi de citire, plus listarea branch-urilor, tag-urilor, remote-urilor și stash-urilor.
- Scriere dispozitiv: comenzile care modifică starea stocată sau contactează un remote, precum add, commit, switch, merge, rebase, reset, fetch, pull, clone și push, și orice comandă care scrie ieșirea într-un fișier. Modurile Întreabă și Editare automată cer aprobarea înaintea fiecăreia.
- Ireversibil: comenzile care pot pierde munca sau pot rescrie istoricul, precum checkout, restore, clean, un reset hard, ștergerea unui stash și push-urile forțate sau de ștergere. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.
- Blocat în orice mod: suprascrierile de configurație, aliasurile executabile și numele de comenzi necunoscute, comenzile interactive și execuția explicită de programe.

## Limitări

- Windows x64, Linux x64 și Linux arm64.
- Git nu rulează izolat: filtrele de conținut precum LFS și driverele textconv sau filter locale depozitului pot rula totuși programe. Tratează cu grijă un depozit în care nu ai încredere.
- Modificările Git nu apar în panoul Modificări al VERA; logul rulării înregistrează fiecare comandă și ieșirea ei.
