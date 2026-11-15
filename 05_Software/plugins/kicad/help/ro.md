# Analiză de schemă și PCB KiCad

Analiza de schemă și PCB KiCad îi permite agentului să analizeze proiecte KiCad 10 fără să le modifice. Citește ierarhia foilor, instanțele de simboluri, net-urile, straturile plăcii, stackup-ul, traseele și clasele de net-uri; rulează ERC și DRC din KiCad și raportează fiecare încălcare cu obiectele și pozițiile ei; și produce un BOM, netlistul KiCad și exporturi de inspecție sau de fabricație (PDF sau SVG pentru schemă și placă, Gerber, fișiere de găurire și de poziții), fiecare verificat. KiCad rulează doar pe o copie a proiectului. Fiecare rulare creează un folder în `electronics-results/` din workbench, cu `result.json`, `report.md` și fișierele proprii ale KiCad.

## Ce necesită

- **KiCad 10**, pe care îl instalezi singur de la https://www.kicad.org/download/ (pe Ubuntu din PPA-ul KiCad 10). Apoi folosește **Verifică dependențele** pe pagina pluginului.
- **kicad-tool**: un script din plugin, instalat automat de **Instalează dependențele**.
- Un proiect KiCad (`.kicad_pro`, `.kicad_sch` sau `.kicad_pcb`) în workbench. Fișierele din KiCad 8 sau 9 rulează cu un avertisment; fișierele mai vechi sau mai noi sunt refuzate și trebuie salvate mai întâi în KiCad 10.
- Fără pluginuri necesare și fără parametri de configurare.

## Cum se folosește

- „Analizează schema din hardware/sensor.kicad_pro.” (skill-ul `schematic-review`)
- „Rulează ERC și listează încălcările cu foile și pozițiile lor.”
- „Rulează DRC pe placă cu zonele reumplute și verifică paritatea cu schema.” (skill-ul `pcb-review`)
- „Exportă BOM-ul și netlistul.”
- „Creează fișierele Gerber, de găurire și de poziții pentru o placă cu două straturi.”

Într-o analiză, agentul ține constatările KiCad separat de propriile observații și marchează fiecare observație ca fapt sau ipoteză. Nu declară un net sau o componentă dimensionate corect fără cerințele electrice din spatele lor. Zero încălcări DRC nu validează funcționarea, capacitatea de curent, impedanța sau căile de întoarcere.

## Risc și aprobări

- Sigur, rulează fără să întrebe în orice mod de permisiuni: toate operațiile `kicad-tool`. Lucrează pe o copie temporară și creează doar foldere noi de rulare; proiectul nu este modificat niciodată, iar o rulare ale cărei surse s-au schimbat între timp este abandonată.
- Blocat: rularea directă a `kicad-cli`, cu excepția versiunii sau a ajutorului, pentru că rescrie fișiere în folderul de proiect pe care îl citește și poate salva sau actualiza un proiect.

Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat cu KiCad 10.0.8 pe Windows 11; Ubuntu x64 nativ este în așteptare.
- ERC și raportul de analiză refuză un proiect care are activată verificarea modelelor de simulare din ERC; setează acea verificare pe ignorare.
- Fără modificări de schemă sau de placă (vezi pluginul kicad-layout), fără export de modele 3D, fără jobset-uri sau actualizări de format.
- Referință: https://docs.kicad.org/10.0/en/cli/cli.html
