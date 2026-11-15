# Simulare de circuite LTspice

Acest plugin îi permite agentului să simuleze circuite în mod batch cu propria ta copie de LTspice pe Windows. Rulează analize de punct de funcționare, DC, AC, tranzitorii și de zgomot pentru un netlist SPICE sau o schemă LTspice .asc, variază parametri și temperatura, rulează Monte Carlo cu seed, face măsurători pe ferestre declarate (riplu, supracreștere, stabilizare, RMS, putere medie) și verifică criterii de trecere/picare. Cererile folosesc același format ca pluginul ngspice, așa că o cerere poate rula pe ambele motoare, iar rezultatele pot fi comparate. Fiecare rulare scrie un folder nou în `electronics-results/` cu intrările, logul și fișierul raw ale LTspice, un grafic și un raport.

## Ce necesită

- **LTspice 26 sau mai nou**, pe care îl instalezi singur de la https://www.analog.com/ltspice (LTspice64.msi, Windows 10/11 x64). VERA îl găsește în folderul de instalare per utilizator sau pentru toți utilizatorii și nu îl instalează niciodată. Dacă instalarea per utilizator eșuează cu eroarea 2503, instalează-l pentru toți utilizatorii dintr-un prompt de administrator: `msiexec /i LTspice64.msi ALLUSERS=1`.
- **ltspice-tool**, un script Python din plugin, pe care VERA îl instalează singură. Agentul lucrează întotdeauna prin el.
- Fără hardware, fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-ul `ltspice-simulation`.

- „Verifică circuits/buck.cir și include-urile lui înainte să-l simulăm.”
- „Convertește circuits/filter.asc într-un netlist și rulează o baleiere AC de la 10 Hz la 100 kHz; punctul de -3 dB trebuie să fie peste 159 Hz.”
- „Rulează o analiză tranzitorie a convertorului buck și măsoară riplul de ieșire după ce s-a stabilizat.”
- „Rulează 50 de rulări Monte Carlo cu toleranță de 5 % pe RLOAD, seed 7.”
- „Rulează aceeași cerere cu ngspice și compară măsurătorile.”

## Risc și aprobări

Toate operațiile ltspice-tool (validate, convert, run, sweep, measure, compare, report) au nivelul **Sigur**: doar simulează pe computerul tău, nu modifică niciodată netlistul, schema, modelele ei sau bibliotecile LTspice și rulează fără să întrebe. Rularea directă a LTspice are nivelul **Blocat**, pentru că un netlist poate scrie fișiere oriunde, iar LTspice își deschide fereastra fără modul batch.

## Limitări

- Doar Windows x64; pluginul nu este oferit pe Linux sau macOS.
- Înainte ca LTspice să ruleze, ltspice-tool refuză directivele care citesc sau scriu fișiere (precum `.wave`), cardurile necunoscute, fișierele criptate sau non-UTF-8 și include-urile din afara workbenchului și a bibliotecii LTspice. Un nod numit, de exemplu, `profile` este refuzat și el, pentru că LTspice recunoaște `file` după prefix.
- Cardurile de analiză și `.meas` din netlist nu se rulează; cererea decide analiza.
- O secțiune de bibliotecă are nevoie de un nume de fișier între ghilimele: `.lib "models/corners.lib" TT`.
- O simulare nu este o măsurătoare hardware: rezultatul este doar atât de bun cât sunt modelele.
