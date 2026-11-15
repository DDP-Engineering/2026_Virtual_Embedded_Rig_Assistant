# Căutare și selecție de componente

Acest plugin îl ajută pe agent să aleagă componente electronice pe baza dovezilor. Agentul caută în cataloagele furnizorilor pe care le activezi (Mouser, DigiKey, TME, Farnell, Rutronik), confirmă valorile critice în datasheetul producătorului, cu pagina și condițiile de test, și compară candidații mai întâi cu constrângerile obligatorii și apoi cu preferințele. Scrie o comparație și un BOM propus într-un folder nou din `electronics-results/`. Nu se comandă nimic și nu se modifică nicio schemă și niciun BOM de proiect.

## Ce necesită

- **parts-compare**, un script Python din plugin, pe care VERA îl instalează singură cu **Instalează dependențele**. Compară offline.
- **Credențialele furnizorilor** (`supplier-keys`): credențiala API a fiecărui furnizor în care vrei să cauți, cu regiunea folosită de căutări. Setează-le în secțiunea **Configurare** de pe pagina pluginului: Mouser (cheie API), DigiKey (client ID și client secret), TME (token API și secretul aplicației), Farnell (cheie API și magazin) și Rutronik (cheie API de la persoana ta de contact Rutronik). Credențialele rămân pe computerul tău și nu sunt niciodată arătate agentului.
- **Acces web** activat în **Setări** și pluginul activat pentru workbench. Căutarea este oferită doar când ambele sunt active și cel puțin un furnizor este activat.
- Fără hardware și fără alte pluginuri.

## Cum se folosește

Agentul folosește skill-ul `component-selection` pentru fluxul de lucru și `component-families` pentru verificările fiecărei familii de componente (MOSFET-uri, regulatoare, amplificatoare operaționale, rezistoare, condensatoare, diode, bobine). Stabilește cu tine constrângerile obligatorii și preferințele înainte să caute.

- „Găsește un MOSFET cu canal N în SOT-23 care comută 5 A de la 24 V cu o comandă de grilă de 3,3 V.”
- „Caută BSS806NE la furnizorii activați și arată ofertele.”
- „Compară aceste trei LDO-uri pentru 3,3 V la 300 mA din 5 V, cel mai ieftin primul, pentru 500 de bucăți în EUR.”
- „Mai are acest MLCC 10 µF la o polarizare DC de 12 V? Verifică datasheetul.”
- „Propune un înlocuitor direct pentru regulatorul de pe placă.”

## Risc și aprobări

Compararea candidaților are nivelul **Sigur**: rulează offline pe computerul tău, nu deschide nicio conexiune de rețea, nu suprascrie niciodată nimic și rulează fără să întrebe. O căutare la furnizori trimite doar textul căutării sau codul piesei către furnizorii pe care i-ai activat.

## Limitări

- Windows x64 și Linux x64.
- Fiecare căutare este live, iar VERA nu stochează niciun rezultat de la furnizori. Ofertele sunt un instantaneu fără taxe sau transport.
- Parametrii furnizorilor sunt neconfirmați până când sunt verificați în datasheet. Valorile de pe curbe sau din pagini scanate trebuie confirmate de tine.
- Date TME: powered by TME.eu Data; nu se garantează acuratețea datelor.
