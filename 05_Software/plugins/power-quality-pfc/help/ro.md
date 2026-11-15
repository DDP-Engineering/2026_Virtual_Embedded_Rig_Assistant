# Calitatea energiei și compensarea puterii reactive

Calitatea energiei și compensarea puterii reactive îi oferă agentului instrumentul integrat `power_quality` al VERA pentru corecția factorului de putere la un tablou. Importă fișiere de măsurători P/Q/S și de armonici într-un format declarat și, pentru fiecare scenariu de rețea și interval măsurat, dă puterea activă și puterea reactivă fundamentală, factorul de deplasare și factorul de putere total în prezența distorsiunilor, kvar necesari pentru a atinge o țintă, o baterie fixă sau automată de trepte egale cu o logică de comandă propusă, supracompensarea la sarcină mică, verificări ale condensatoarelor, bobinelor de antirezonanță, contactoarelor și protecției treptelor față de datele de catalog citate, precum și rezonanța paralelă față de ordinele armonice măsurate. Fiecare rezultat își declară sursele, unitățile, ipotezele și limitele. Propune; nu comută niciodată o treaptă și nu setează un regulator.

## Ce necesită

- Fără programe: pluginul aduce un skill, iar agentul folosește instrumentul integrat al VERA, oferit doar cât timp pluginul este activat. Nu e nimic de instalat.
- Tabloul din modelul electric al proiectului, ideal cu un rezultat de rețea curent (skill-ul `network-sizing`), care dă P și Q ale tabloului pe scenarii și nivelul de scurtcircuit pentru verificarea rezonanței.
- Un fișier de măsurători cu timpul, unitățile și convențiile de semn declarate. Dacă exportul nu spune dacă Q este fundamental sau ce semn are, tu formulezi ipoteza; agentul nu o ghicește niciodată.
- Ținta și limitele pe care le poți stabili doar tu: factorul de putere țintă, toleranța de tensiune, marja de rezonanță, ieșirile regulatorului. Date de catalog citate (condensatoare, bobine, contactoare, protecție) pentru verificarea echipamentelor.

## Cum se folosește

- „Importă acest export de analizor pentru tabloul principal și arată factorul de deplasare și factorul de putere total.” (skill-ul `power-factor-correction`)
- „Câți kvar îmi trebuie ca să ajung la 0,95 la acest tablou, în fiecare scenariu?”
- „Propune o baterie fixă sau automată și explică de ce, inclusiv supracompensarea la sarcina cea mai mică.”
- „Verifică aceste condensatoare, bobine de antirezonanță și contactoare față de catalog.”
- „Intră bateria în rezonanță lângă un ordin armonic măsurat, la un nivel de scurtcircuit de 20 MVA?”
- „Tratează Q din acest fișier ca fundamental și notează ipoteza în rezultat.”

Fișierele de măsurători ajung în `electrical-automation-measurements/`, iar fiecare rezultat în `electrical-automation-results/<run-id>/`; un rezultat nu suprascrie niciodată unul anterior și este marcat învechit când modelul se schimbă.

## Risc și aprobări

Instrumentul este de scriere: nu este oferit în sesiunile Doar citire, iar VERA întreabă înainte să salveze un rezultat sau un fișier de măsurători, ca la orice scriere de fișier. Nu modifică modelul, nu comută nicio treaptă de condensatoare și nu setează niciun regulator. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Suport de inginerie preliminar: fără proiect verificat, fără declarație de conformitate și fără raport complet de calitate a energiei. Condensatoarele corectează doar partea de deplasare.
- Datele lipsă rămân necunoscute și nu trec niciodată: fără nivel de scurtcircuit, marjă sau date armonice verdictul de rezonanță este necunoscut, iar o pereche condensator-bobină se acceptă doar dintr-un tabel citat.
- Fără proiectare de filtre, fără regimuri tranzitorii de comutare, fără nivelul minim de scurtcircuit (rezultatul de rețea dă doar maximul).
