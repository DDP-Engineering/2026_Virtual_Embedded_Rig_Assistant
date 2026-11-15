# Profilare energetică

Acest plugin îi permite agentului să măsoare curentul, tensiunea, puterea, energia și sarcina electrică ale unei plăci cu un Joulescope JS220 și să analizeze capturile offline. O captură leagă datele de build-ul de firmware și înregistrează markeri GPI pentru evenimente; golurile și depășirile nu devin niciodată zero. Analiza dă curentul mediu, minim și maxim, energia și sarcina, timpul petrecut în stările de sleep și active, energia per eveniment, o comparație de firmware A/B și un interval de autonomie a bateriei cu ipotezele lui. Rezultatele ajung în `embedded-lab-results/`.

## Ce necesită

- **power-profile** (cu pyjoulescope_driver 2.5.5) și **power-analyze**, scripturi Python pe care VERA le instalează singură cu **Instalează dependențele**.
- **Un Joulescope JS220**, prin care este alimentată placa. Accesul USB necesită WinUSB pe Windows sau regula udev a producătorului pe Linux, pe care le configurezi singur.
- **Registrul de laborator** `lab/resources.json` în workbench (obligatoriu), care declară aparatul de măsură ca monitor de putere, de exemplu cu aliasul `js1`. Secțiunea **Configurare** de pe pagina pluginului arată dacă fișierul este prezent și valid.
- Fără alte pluginuri. Un verdict de firmware A/B folosește lab-validate din pluginul lab-validation.

## Cum se folosește

Agentul folosește skill-urile `power-measurement` și `energy-analysis`. Întreabă cum este cablată placa, ce GPIO-uri ajung la intrările GPI ale aparatului și care este tensiunea de alimentare.

- „Identifică aparatul js1 și verifică driverul și accesul USB.”
- „Capturează 20 de secunde la 100 kHz cu markerul 0, firmware build/app.elf, placa sensor-node rev B la 3,3 V.”
- „Măsoară energia și sarcina acelei capturi între 2 s și 12 s.”
- „Împarte captura în treziri după markerul 0 și dă-mi energia per trezire și curentul în sleep.”
- „Compară firmware-ul A cu B și estimează autonomia bateriei cu battery.json.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): verificarea cerințelor preliminare ale driverului și fiecare pas de analiză offline.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): listarea aparatelor conectate și identificarea aparatului; nu se modifică nimic.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): o captură, pentru că setează rata de eșantionare și domeniul aparatului, ceea ce schimbă tensiunea de sarcină (burden) în serie cu placa ta (setările anterioare sunt restaurate după aceea); și curățarea făcută de VERA după o captură întreruptă.

Pluginul nu comută niciodată calea de curent a plăcii, nu acționează ieșirile aparatului și nu îi actualizează firmware-ul.

## Limitări

- Windows x64 și Linux x64.
- Profilul JS220 nu este încă verificat cu un aparat real.
- O captură conține cel mult 1 000 000 de eșantioane.
- Dacă calea de curent a aparatului este oprită, capturile sunt refuzate.
- Nu sunt oferite: o consolă a aparatului, controlul căii de alimentare, fișiere JLS și alte aparate precum PPK2 sau Otii.
