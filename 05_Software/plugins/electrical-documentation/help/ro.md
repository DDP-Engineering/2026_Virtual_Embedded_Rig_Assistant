# Documentație electrică

Documentația electrică permite agentului să genereze listele proiectului - materiale, fire (conexiuni), cabluri, borne, etichete și I/O, cu un cuprins - din ce cunoaște deja VERA: modelul electric, o verificare de tablou salvată și schemele QElectroTech pe care le numiți. Fiecare rând arată fișierul din care provine, cu hash-ul acestuia, iar listele sunt verificate una față de alta.

## De ce are nevoie

- **Niciun program.** Agentul folosește instrumentele integrate ale VERA `electrical_documentation`, `electrical_documentation_check` și `electrical_documentation_export`, oferite doar cât timp acest plugin este activat. Nu este nimic de instalat sau descărcat, deci **Instalează dependențele** nu are nimic de făcut aici.
- O verificare de tablou salvată (pluginul Panel engineering) și schemele QElectroTech ale motoarelor (pluginul QElectroTech schematics).
- Pentru tagurile PLC, opțional, un fișier de taguri exportat din instrumentul PLC: un fișier CSV cu coloanele `name` și `address` (și opțional `dataType`, `comment`). Nu se deschide niciun proiect PLC.
- Pentru revizie, un obiect document în modelul electric cu atributul `revision` (și opțional `date`, `author`).

## Cum se folosește

- „Fă documentația pentru tabloul MCP1 din ultima verificare de tablou și schemele M1 și M2, cu tagurile din plc/tags.csv." (skill `electrical-documentation`)
- „Arată-mi lista de fire."
- „Care I/O nu au tag sau au altă adresă în fișierul de taguri?"
- „Ce s-a schimbat de la ultima rulare de documentație?"
- „Exportă lista de borne ca CSV și totul ca PDF."

Rezultatul este salvat în `electrical-automation-results/<run-id>/`; exporturile sunt scrise lângă el ca fișiere noi.

## Ce se verifică

- Numerotarea firelor: un număr pe potențial, niciun număr pe două potențiale, fiecare conductor numerotat și conectat la ambele capete, niciodată două conductoare între aceleași borne.
- Etichete desenate într-o schemă care nu sunt nici în tablou, nici în model, și conexiuni ale pornitoarelor pe care schema nu le desenează.
- Cabluri fără capăt în tablou sau la sarcină și borne care depășesc dimensiunea șirului lor.
- Pentru fiecare I/O: aparatul, borna fizică, adresa pe un modul PLC din tablou și exact un tag, precum și aceeași adresă în fișierul de taguri.
- Revizia: conținut schimbat sub aceeași revizie sau o foaie de schemă cu altă revizie.

## Risc și aprobări

`electrical_documentation` doar citește. `electrical_documentation_check` și `electrical_documentation_export` sunt instrumente de scriere: cer aprobarea ca la scrierea unui fișier și nu sunt oferite în sesiunile Read-only. Scriu doar noul fișier de rezultat sau de export; modelul, fișierul de tablou, schemele și fișierul de taguri nu sunt modificate niciodată - diferențele sunt raportate pentru a le corecta dumneavoastră. Nimic nu este printat, comandat sau trimis.

## Limite

- Listele conțin doar ce conțin modelul, verificarea de tablou, schemele numite și fișierul de taguri; revizia și autorul nu sunt niciodată inventate.
- Exporturile sunt în engleză. Textul PDF folosește fontul standard Courier: caracterele din afara textului vest-european (de exemplu ș, ț) apar ca `?`.
- Verificat pe Windows x64 și cu proiecte în format QElectroTech scrise de VERA; încă nerulat pe Ubuntu x64 nativ sau pe proiecte numerotate salvate de QElectroTech.
