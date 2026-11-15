# Calcule electronice

Calculele electronice îi oferă agentului un calculator pentru numerele pe care se sprijină o decizie de proiectare, astfel încât să facă efectiv calculul în loc să-l estimeze. Acoperă legea lui Ohm, rezistențe în serie, în paralel și șunturi, divizoare de tensiune, constante de timp RC, filtre și forme de undă, pierderi în regulatoare liniare, rezistoare, MOSFET-uri, diode, condensatoare și bobine, bugete de putere, temperaturi de joncțiune, de capsulă și de radiator, rețele Foster tranzitorii și analiza toleranțelor în cel mai defavorabil caz și Monte Carlo. Fiecare rezultat își declară unitățile, formulele, ipotezele, limitele și verificările. Rulează offline și nu atinge hardware.

## Ce necesită

- **elec-calc**: un script pe biblioteca standard Python, instalat automat de **Instalează dependențele** de pe pagina pluginului. Nu se descarcă nimic.
- Valorile de intrare cu unitățile lor, ideal cu sursa din datasheet și condițiile fiecăreia. Agentul cere o valoare lipsă în loc să o inventeze, să o citească de pe un grafic sau să o scaleze la alte condiții.
- Fără pluginuri necesare, hardware sau configurare.

## Cum se folosește

- „Ce rezistor de sus dă 3,3 V din 5 V cu un rezistor de jos de 10 kΩ?” (skill-ul `electronics-sizing`)
- „Cât disipă LDO-ul la 12 V intrare, 3,3 V ieșire, 300 mA și 5 mA curent de repaus?”
- „Rămâne joncțiunea regulatorului sub 125 °C la 40 °C ambiant, cu thetaJA 50 K/W pe o placă JEDEC 2s2p?” (skill-ul `thermal-analysis`)
- „Ce radiator îmi trebuie pentru 10 W la 50 °C ambiant?”
- „Verifică ieșirea divizorului cu rezistoare de 1 % și o intrare de 4,9–5,1 V, în cel mai defavorabil caz și Monte Carlo.”
- „Salvează aceste calcule pentru etajul de putere ca raport.”

Un raport ajunge în `electronics-results/<run-id>/` din workbench, ca `report.json` și `report.md`; nu suprascrie niciodată o rulare existentă.

## Risc și aprobări

Fiecare comandă a acestui plugin este sigură și rulează fără să întrebe în orice mod de permisiuni, inclusiv Doar citire. Calculele își citesc cererea și nu modifică niciun fișier; doar `report` creează un nou folder de rezultate în workbench. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64; încă nerulat pe Ubuntu x64 nativ.
- Analiza toleranțelor acceptă cel mult 6 ieșiri, 12 parametri și 100.000 de eșantioane Monte Carlo; o rulare mare poate dura aproximativ un minut. Analiza colțurilor găsește extremele doar acolo unde o ieșire este monotonă în fiecare parametru, iar rezultatul spune unde nu este cazul.
- thetaJA nu se combină niciodată cu rezistențe termice joncțiune-capsulă; descrie deja întreaga cale pe placa sa de test (vezi https://www.ti.com/lit/an/spra953d/spra953d.pdf).
- Fără certificare termică, CFD sau FEM, rețele Cauer, suprapunere termică pentru impulsuri repetitive, estimarea pierderilor în miezuri magnetice sau dimensionarea izolației.
