# Rețea electrică și dimensionarea cablurilor

Rețeaua electrică și dimensionarea cablurilor îi permit agentului să calculeze o rețea radială de joasă tensiune din modelul electric al workbench-ului în loc să o estimeze. Acoperă bilanțul de sarcină P/Q/S pe scenarii, cu factori de simultaneitate și de încărcare, curenți de fază și de neutru, curenți de calcul, secțiuni de cablu verificate sau propuse dintr-un tabel de cabluri citat, căderea de tensiune monofazată și trifazată și curenții de defect maximi și minimi prin metoda impedanțelor, după IEC 60909-0:2016. Fiecare rezultat își declară metoda, intrările, unitățile, ipotezele și limitele. Rulează offline și nu atinge hardware.

## Ce necesită

- Niciun program și nimic de instalat: pluginul nu are. Agentul folosește instrumentul integrat `electrical_network` al VERA, oferit doar cât timp pluginul este activat și niciodată în sesiuni Doar citire.
- Un model electric în workbench, `electrical-automation-model.json`, cu un transformator sau un punct de alimentare JT, circuitele, cablurile și consumatorii lui.
- Un tabel de cabluri în `electrical-automation-tables/`, cu valori citate. VERA nu livrează niciun tabel IEC 60364-5-52; introdu valori dintr-un datasheet sau dintr-un standard pe care îl deții.
- Modul de pozare, temperatura ambiantă, grupările și nivelul de defect. Agentul cere o valoare lipsă în loc să o inventeze.

## Cum se folosește

- „Calculează bilanțul de sarcină al tabloului principal pentru funcționarea normală și cu pompa oprită.” (skill-ul `network-sizing`)
- „Verifică secțiunile cablurilor tuturor circuitelor față de acest tabel de cabluri.”
- „Ce secțiune propui pentru cablul spre motorul M1 și care criteriu decide?”
- „Care este căderea de tensiune la capătul celui mai lung circuit, față de o limită de 4 %?”
- „Care sunt curenții de defect maximi și minimi la tablou și la capetele circuitelor?”
- „Arată din nou rezultatul stocat și spune-mi dacă este învechit.”

Un rezultat este stocat ca un nou `electrical-automation-results/<run-id>/result.json`, împreună cu intrările lui, așa că o modificare ulterioară a modelului îl marchează ca învechit. O secțiune propusă este doar o propunere; acceptarea ei trece printr-o modificare a modelului pe care o aprobi.

## Risc și aprobări

`electrical_network` scrie un singur fișier nou de rezultat și cere aprobare ca o scriere de fișier. Nu modifică niciodată modelul, o schemă sau o selecție aprobată; modificarea modelului folosește `electrical_model_change`, care cere și ea aprobare. Afișarea unui rezultat stocat cu `electrical_model` este doar citire. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Un transformator (Dyn pentru defecte la pământ) sau un punct de alimentare JT, curent alternativ trifazat până la 1000 V, alimentări radiale, un cablu pe circuit. Rețelele buclate, cuplele între bare, cablurile în paralel, generatoarele, UPS-urile, PV și curentul continuu nu sunt evaluate sau opresc rularea.
- Datele lipsă rămân necunoscute și nu trec niciodată; sursele sau topologiile neacceptate nu sunt evaluate. Factorii se iau la următorul punct tabelat, niciodată interpolat.
- Fixturile sunt mici și citate; nu se livrează tabele IEC și nici cataloage complete de producători. Un tabel fără reactanță cere o valoare asumată convenită, înregistrată ca ipoteză.
- Rezultatele sunt suport ingineresc preliminar, nu un proiect verificat, o declarație de conformitate sau o certificare de siguranță. Alegerea aparatelor de protecție, timpii de deconectare și selectivitatea țin de coordonarea protecțiilor.
