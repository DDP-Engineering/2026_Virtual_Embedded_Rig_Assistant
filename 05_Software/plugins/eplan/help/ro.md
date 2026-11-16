# Schimb de date EPLAN

Schimbul de date EPLAN îi permite agentului să compare proiectul dumneavoastră EPLAN Electric P8 2025 cu documentația electrică din VERA și să trimită înapoi în EPLAN date de produs aprobate. Citește lista de aparate și tabelele de borne și conexiuni exportate de EPLAN, arată ce diferă de listele de documentație, pregătește un fișier de listă de aparate pentru import și îl importă într-o copie a proiectului, niciodată în original. O verificare arată apoi dacă fiecare valoare a ajuns și nimic altceva nu s-a schimbat.

**Încă neverificat cu o instalare EPLAN reală.** Urmează documentația publică a API-ului EPLAN; încercați-l mai întâi pe o copie a unui proiect de test.

## De ce are nevoie

- Propriul EPLAN Electric P8 2025 licențiat, pe Windows, instalat în dosarul implicit (Program Files\EPLAN\Platform\2025...). VERA nu instalează și nu include nimic din EPLAN.
- Programul **eplan-tool** al acestui plugin (un mic script Python): folosiți **Install dependencies** pe pagina pluginului.
- Un fișier de profil în `electrical-automation-eplan/` care numește fișierul proiectului (.elk, cale fără spații) și antetele coloanelor din exporturile EPLAN. Pentru borne și conexiuni, o schemă de export EPLAN („editare externă”) care scrie text separat prin punct și virgulă, cu rând de antet.
- O rulare de documentație electrică actuală (pluginul Documentație electrică) pentru comparație.

## Cum se folosește

- „Scrie un profil EPLAN pentru C:\EPLAN\Projects\PlantM.elk cu aceste antete de coloană.” (skill `eplan-exchange`)
- „Exportă din EPLAN lista de aparate și tabelele de borne și conexiuni.”
- „Compară exportul EPLAN cu ultima rulare de documentație.”
- „Pregătește un fișier de import care corectează codurile de produs în EPLAN.”
- „Importă-l într-o copie a proiectului și verifică dacă a ajuns totul.”

## Risc și aprobări

`eplan` doar citește. `eplan_change` și `eplan_check` sunt instrumente de scriere: cer aprobarea ca o scriere de fișier și nu sunt oferite în sesiunile doar-citire. **eplan-tool export** este o acțiune de citire de dispozitiv: pornește EPLAN cu proiectul deschis doar pentru citire. **eplan-tool import** este o acțiune de scriere de dispozitiv: creează o copie nouă a proiectului și importă fișierul aprobat în acea copie; proiectul original nu se schimbă. Fiecare comandă EPLAN își numește proiectul; nimic nu se atașează la un EPLAN deschis de dumneavoastră și nu se rulează niciun script din proiect. Un import eșuat, refuzat sau oprit nu este raportat niciodată ca aplicat.

## Limite

- Doar Windows x64. Încă nerulat cu un EPLAN real: structura fișierelor, codurile de ieșire, mesajele de licență și comportamentul cu un proiect deschis în altă parte sunt neconfirmate.
- Se importă doar lista de aparate (codurile de produs și coloana de ID VERA). Conexiunile, bornele și macro-urile sunt comparate, dar niciodată importate; macro-urile nu sunt tratate deloc.
- Căile date către EPLAN nu pot conține spații sau ghilimele.
- Rezultatele sunt suport ingineresc preliminar: nu reprezintă un proiect verificat și nici o declarație de conformitate.
