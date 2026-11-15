# Pornire și acționări de motoare

Pornire și acționări de motoare îi permite agentului să compare cum poate fi pornit sau acționat fiecare motor din modelul tău electric și să dimensioneze ce are nevoie, în loc să aleagă doar după putere. Pentru fiecare motor compară pornirea directă, inversarea sensului, stea-triunghi, softstarterul și variatorul de turație cu funcția procesului, limita curentului de pornire, cuplul de accelerare, timpul de accelerare și numărul de porniri pe oră. Propune cea mai simplă metodă care trece, dimensionează contactoarele pe categorii de utilizare, releul termic, un softstarter sau un variator după curent și suprasarcină, cu declasare citată, și returnează o schemă logică de conexiuni și interblocări. Fiecare rezultat își declară sursele, unitățile, ipotezele și limitele.

## Ce necesită

- **Fără program.** Agentul folosește instrumentul integrat al VERA `motor_drives`, oferit doar cât timp acest plugin este activat. Nu e nimic de instalat sau descărcat, deci **Instalează dependențele** nu are nimic de făcut aici.
- Un rezultat curent de protecție și coordonare (skill-ul `protection-selection`), care la rândul lui necesită un rezultat curent al rețelei electrice; cele vechi sunt refuzate.
- Catalogul industrial cu contactoare, relee termice, softstartere și variatoare, cu valori și condiții citate.
- Date despre motor și sarcină în model (plăcuță, rapoarte de cuplu, inerții, cuplu de sarcină, porniri pe oră) și funcția procesului și limitele convenite cu agentul. Valorile lipsă rămân necunoscute; agentul întreabă în loc să folosească o valoare tipică.

## Cum se folosește

- „Compară DOL, stea-triunghi și un variator pentru motorul pompei M2.” (skill-ul `motor-starting`)
- „Este permis stea-triunghi pentru acest motor și rămâne curentul de pornire pe linie sub limita furnizorului?”
- „Cât durează accelerarea benzii transportoare și este sub timpul de rotor blocat?”
- „Dimensionează contactoarele și releul termic pentru metoda propusă.”
- „Ce clasă de serviciu a variatorului acoperă curentul continuu și de suprasarcină, cu declasare la 45 °C și 1000 m?”
- „Dă-mi schema de conexiuni și interblocări pentru demaroarul cu inversare.”

Rezultatul se salvează cu copii ale motoarelor, circuitelor și cablurilor citite în `electrical-automation-results/<run-id>/` din workbench. Dacă modelul se schimbă ulterior, rezultatul este marcat ca vechi.

## Risc și aprobări

Instrumentul este de scriere: salvează un singur rezultat nou și cere aprobarea ta ca la o scriere de fișier. Nu este oferit în sesiunile Doar citire. Nu modifică niciodată modelul electric și nu configurează sau parametrizează niciun variator, softstarter sau releu. Nu există acțiuni de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Timpul de accelerare și curbele de cuplu sunt valori de model cu ipoteze declarate, nu performanță garantată.
- Datele lipsă rămân necunoscute și nu trec niciodată. Energia de frânare, categoria EMC, lungimea cablului motorului și tipurile RCD contează doar din date citate; orice altceva este o întrebare pentru producător. Pornirile pe oră ale softstarterelor, categoria EMC a unui variator și lungimea maximă a cablului motorului lipsesc adesea din paginile publice.
- Verdictele despre dispozitivul de protecție și coordonarea demaroarelor sunt copiate din rezultatul de protecție, nu citite din suprapunerea curbelor.
- Fixturile sunt mici și citate; tabelele licențiate ale producătorilor nu sunt livrate.
- Rezultatele sunt suport ingineresc preliminar: nu se pretinde un proiect verificat, o declarație de conformitate sau o funcție de siguranță. Schema este un punct de plecare logic pentru desene.
