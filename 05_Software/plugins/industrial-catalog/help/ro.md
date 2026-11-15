# Catalog industrial și selecție documentată

Catalogul industrial și selecția documentată îi permit agentului să aleagă echipamente de joasă tensiune pe baza dovezilor de la producător, nu din memorie sau din textul unui distribuitor. Acoperă contactoare, disjunctoare pentru motoare, protecții, variatoare, module PLC și I/O și accesorii. Catalogurile sunt fișiere din workbench care păstrează codul de comandă al producătorului, varianta și accesoriile separat de SKU-urile distribuitorilor, fiecare parametru fiind citat cu sursa, revizia și pagina sau tabelul, în condițiile sale. Agentul selectează pe baza cerințelor tale ferme, explică fiecare eliminare și își declară sursele, unitățile și limitele. Rulează offline și nu atinge hardware.

## Ce necesită

- Niciun program și nimic de instalat: pluginul nu are. Agentul folosește instrumentul integrat `industrial_catalog` al VERA, oferit doar cât timp pluginul este activat.
- Un catalog în `electrical-automation-catalogs/` din workbench. Tu sau agentul puteți scrie ori importa unul printr-o scriere obișnuită de fișier aprobată; un fișier defect este listat fără să-i oprească pe ceilalți.
- Cerințele tale cu condițiile lor: tensiunea, categoria de utilizare, temperatura ambiantă. Agentul cere una lipsă în loc să presupună o marjă.
- Fără pluginuri necesare, hardware sau configurare.

## Cum se folosește

- „Care contactoare din catalog se potrivesc unui motor de 4 kW, 400 V, în AC-3, cu bobină de 230 V?” (skill-ul `industrial-selection`)
- „Găsește articolul cu codul de comandă LC1D09P7 și spune-mi dacă numărul pe care îl am este un cod de comandă sau un SKU de distribuitor.”
- „Ce disjunctoare pentru motoare suportă 20 kA la 400 V și pot fi reglate la 8,5 A?”
- „De ce a fost eliminat acest articol și ce valori sunt încă necunoscute?”
- „Este valabilă coordonarea cu siguranțe pentru aceste două produse exacte la 400 V?”
- „Propune acest contactor pentru model, cu producător și cod de comandă, având catalogul ca sursă.”

Fiecare rezultat este eligibil, necunoscut sau eliminat, iar fiecare valoare este citată cu condițiile și sursa ei. Un preț mai mic, mai mult stoc sau o denumire asemănătoare nu fac niciodată două articole echivalente. Agentul nu scrie singur în catalog.

## Risc și aprobări

Instrumentul `industrial_catalog` doar citește fișiere: nu cere aprobare, nu caută nimic live și nu stochează nimic. Scrierea unui catalog sau o modificare a modelului care înregistrează alegerea ta (`electrical_model_change`) cere aprobare ca orice scriere de fișier. Nu se extrage nimic de pe site-uri, nu se comandă nimic și nu se înlocuiește nimic într-o schemă; nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Valorile lipsă sau neconfirmate rămân necunoscute și nu trec niciodată. O valoare marcată ca extrasă nu e verificată față de sursă și nu decide niciodată o cerință.
- Tabelele de coordonare se aplică doar produselor, tensiunii și condițiilor exacte pe care le numesc; altfel coordonarea rămâne necunoscută.
- Nu se livrează cataloage complete de producători și nici tabele IEC. Fixtura inclusă este mică și citată, câteva contactoare și disjunctoare pentru motoare preluate din pagini publice de produs, iar tabelele de coordonare licențiate ale producătorilor nu sunt în ea. Introdu doar valori pe care ai voie să le folosești și notează termenii de licență ai fiecărei surse.
- Prețurile și stocul live vin din pluginul parts-search și sunt doar informații comerciale. O selecție este o propunere, nu o aprobare de proiect.
