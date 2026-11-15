# Simulare de circuite ngspice

Acest plugin îi permite agentului să simuleze circuite local cu ngspice. Rulează analize de punct de funcționare, DC, AC, tranzitorii și de zgomot pentru netlistul tău SPICE (scris de mână sau exportat din KiCad) cu modele locale, face măsurători pe ferestre declarate (riplu, supracreștere, stabilizare, RMS, putere medie), verifică criterii de trecere/picare, variază parametri și temperatura, rulează Monte Carlo cu seed, compară rulări și scrie rapoarte. Netlisturile sunt verificate înainte să ruleze motorul, iar fiecare rulare scrie un folder nou în `electronics-results/` cu logul, netlistul efectiv, hash-urile intrărilor, un fișier de serii, un grafic, un fișier de rezultat și un raport.

## Ce necesită

- **ngspice 42 sau mai nou.** Pe Windows, **Instalează dependențele** descarcă build-ul oficial fixat ngspice-47 în folderul de programe al VERA; VERA folosește și propria ta copie din `C:\Spice64`. Pe Ubuntu nu există un binar oficial: instalează-l singur cu `sudo apt install ngspice`. Secțiunea **Dependențe** de pe pagina pluginului arată ce s-a găsit.
- **ngspice-tool**, un script Python din plugin, pe care VERA îl instalează singură. Agentul lucrează întotdeauna prin el.
- Fără hardware, fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-ul `circuit-simulation`. Declară analiza, ferestrele de măsurare și criteriile înainte să se uite la rezultate.

- „Verifică circuits/buck.cir și listează-i modelele și subcircuitele.”
- „Rulează o analiză tranzitorie de 2 ms a convertorului buck; riplul de ieșire între 1 ms și 2 ms trebuie să fie cel mult 50 mV.”
- „Măsoară puterea medie în comutator între 1 ms și 2 ms.”
- „Variază RLOAD între 1k și 3k și compară rulările.”
- „Rulează 50 de rulări Monte Carlo cu toleranță de 5 % pe RLOAD, seed 7, și scrie un raport.”
- „Construiește o rețea termică RC cu parametri concentrați pentru regulator și găsește-i temperatura în regim staționar.”

## Risc și aprobări

Toate operațiile ngspice-tool (validate, run, sweep, measure, compare, report) au nivelul **Sigur**: doar simulează pe computerul tău, nu modifică niciodată netlistul sau modelele lui și rulează fără să întrebe. Rularea directă a ngspice are nivelul **Blocat**, pentru că blocul de control al unui netlist poate rula comenzi shell și poate scrie fișiere.

## Limitări

- Windows x64 și Linux x64.
- Refuzate înainte să ruleze motorul: blocurile `.control`, cardurile necunoscute, liniile `*#` și `;#` (ngspice le rulează ca comenzi), instanțele XSPICE `A`, încărcarea de cod, `shell`, include-urile din afara workbenchului, modelele sau subcircuitele nedefinite și instanțele de subcircuit cu număr greșit de pini.
- Cardurile de analiză din netlist (`.tran`, `.ac`, `.meas`, `.print`) nu se rulează; cererea decide analiza.
- O rulare care nu converge este raportată, nu reîncercată cu setări relaxate ale solverului.
- O simulare nu este o măsurătoare hardware: rezultatul este doar atât de bun cât sunt modelele.
