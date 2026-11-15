# Protecție și coordonare

Protecție și coordonare îi permite agentului să verifice siguranțe fuzibile și disjunctoare candidate pentru circuitele modelului tău electric, în loc să le judece din ochi. Pentru fiecare candidat verifică tensiunea nominală, polii, capacitatea de rupere de tipul numit de profil (Icu, Ics sau Icn), Ib <= In <= Iz, I2 <= 1,45 Iz, deconectarea automată pe baza benzilor de declanșare citate, energia lăsată să treacă față de k²S² și tipul și sensibilitatea RCD. Selectivitatea, cascadarea și coordonarea demaroarelor provin numai din tabelele producătorului pentru exact acele produse. Fiecare rezultat își declară sursele, unitățile, condițiile și limitele.

## Ce necesită

- **Fără program.** Agentul folosește instrumentul integrat al VERA `protection_coordination`, oferit doar cât timp acest plugin este activat. Nu e nimic de instalat sau descărcat, deci **Instalează dependențele** nu are nimic de făcut aici.
- Un rezultat curent al rețelei electrice a proiectului (skill-ul `network-sizing`); unul vechi este refuzat.
- Catalogul industrial cu siguranțele și disjunctoarele candidate, ca articole cu valori și condiții citate.
- Valorile de profil convenite cu agentul: tipul capacității de rupere, timpii de deconectare și sensibilitatea RCD. Agentul nu le alege singur.

## Cum se folosește

- „Care dintre aceste două disjunctoare poate proteja circuitul Q3 la curentul de defect de la originea lui?” (skill-ul `protection-selection`)
- „Verifică siguranța gG de 16 A față de Iz al cablului și de timpul de deconectare la capătul circuitului.”
- „Rămâne energia lăsată să treacă de disjunctor sub k²S² pentru acest cablu?”
- „Tipul RCD este permis de manualul variatorului și este sensibilitatea în limita profilului?”
- „Este disjunctorul selectiv față de siguranța din amonte? Folosește tabelul producătorului.”
- „De ce este coordonarea demaroarului necunoscută și ce date ar lămuri-o?”

Rezultatul se salvează împreună cu intrările sale în `electrical-automation-results/<run-id>/` din workbench. Dacă modelul se schimbă ulterior, rezultatul este marcat ca vechi.

## Risc și aprobări

Instrumentul este de scriere: salvează un singur rezultat nou și cere aprobarea ta ca la o scriere de fișier. Nu este oferit în sesiunile Doar citire. Nu modifică niciodată modelul electric, nu configurează niciun dispozitiv și nu scrie setări de releu sau de disjunctor. Nu există acțiuni de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Selectivitatea, cascadarea și coordonarea de tip 1 / tip 2 nu se citesc niciodată din suprapunerea curbelor. Fără un tabel al producătorului pentru exact acele produse și condiții, perechea nu este evaluată.
- Datele lipsă rămân necunoscute și nu trec niciodată: o valoare de catalog extrasă, absentă sau în afara condițiilor, o curbă fără bandă sau un curent de declanșare magnetică fără toleranță ori timp de acționare lasă criteriul deschis. Icu, Ics și Icn nu se înlocuiesc niciodată între ele.
- Fixturile sunt mici și citate; tabelele licențiate ale producătorilor nu sunt livrate. Tabelele publice cu curent prezumat, timpi numerici de acționare instantanee, porți timp-curent ale siguranțelor și I²t sunt adesea doar pentru descărcare sau doar cu licență, deci acele criterii rămân deschise până le furnizezi.
- Rezultatele sunt suport ingineresc preliminar: nu sunt un proiect verificat, o declarație de conformitate sau o funcție de siguranță.
