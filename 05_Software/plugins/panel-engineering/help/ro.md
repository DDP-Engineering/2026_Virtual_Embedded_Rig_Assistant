# Inginerie de tablou

Ingineria de tablou permite agentului să planifice și să verifice un tablou de comandă alături de modelul electric al proiectului. Descrieți carcasa și placa de montaj, șinele, canalele, zonele cu regulile dumneavoastră, aparatajul, șirurile de borne, sursa de 24 V, scenariile, rezerva și condițiile termice într-un fișier de tablou; verificarea reconciliază lista de aparataj cu pornitoarele motoarelor, modelul și schemele QElectroTech, amplasează fiecare aparat pe șine cu dimensiunile reale, face bugetul sursei de 24 V și estimează temperatura aerului din carcasă.

## De ce are nevoie

- **Niciun program.** Agentul folosește instrumentele integrate ale VERA `panel_engineering` și `panel_engineering_check`, oferite doar cât timp acest plugin este activat. Nu este nimic de instalat sau descărcat, deci **Instalează dependențele** nu are nimic de făcut aici.
- Un rezultat curent de pornire a motoarelor (pluginul Motor starting and drives) și cataloage industriale cu dimensiunile, pierderile și accesoriile aparatelor (pluginul Industrial catalog and documented selection).
- Opțional, schemele QElectroTech ale motoarelor (pluginul QElectroTech schematics).

## Cum se folosește

- „Propune aparatajul tabloului pentru M1 și M2 din ultimul rezultat al motoarelor." (skill `panel-engineering`)
- „Scrie fișierul de tablou pentru MCP1: carcasă 600 x 400 x 200 pe perete, trei șine, o sursă de 24 V pentru PLC."
- „Verifică tabloul față de rezultatul motoarelor și cele două scheme."
- „Ce aparate nu au putut fi amplasate și de ce?"
- „Am înlocuit KM1-M1 - ce trebuie refăcut?"
- „Exportă lista de materiale ca CSV și amplasarea ca SVG."

Rezultatul este salvat în `electrical-automation-results/<run-id>/` cu hash-urile fișierului de tablou, ale cataloagelor și schemelor; dacă modelul se schimbă, este marcat ca învechit.

## Risc și aprobări

`panel_engineering` doar citește. `panel_engineering_check` este un instrument de scriere: cere aprobarea ca o scriere de fișier și nu este oferit în sesiunile doar-citire. Scrie doar noul fișier de rezultat; modelul, fișierul de tablou, cataloagele și schemele nu se schimbă. Nu există acțiuni de citire sau scriere pe dispozitive și nici acțiuni ireversibile.

## Limite

- Un accesoriu este considerat compatibil doar când catalogul îl listează pentru aparatul gazdă; altfel rămâne deschis.
- O dimensiune sau o pierdere lipsă rămâne necunoscută: aparatul nu este amplasat și disiparea nu este însumată, niciodată considerată zero.
- Temperatura aerului este bilanțul termic al carcasei din catalogul de carcase Schneider Electric (valoare medie, pierderi la valorile nominale); partea de sus a carcasei este mai caldă.
- Rezistența la scurtcircuit cere valoarea declarată a ansamblului; barele nu sunt evaluate.
- Nu se declară conformitate IEC 61439, nu există amplasare 3D sau date de prelucrare. Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Rezultatele sunt suport de inginerie preliminar: nu sunt un proiect verificat și nici o funcție de siguranță.
