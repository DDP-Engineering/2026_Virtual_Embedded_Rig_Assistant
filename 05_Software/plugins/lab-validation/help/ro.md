# Validarea măsurătorilor

Validarea măsurătorilor compară capturile de laborator și simulările cu cerințele, offline și reproductibil. Agentul scrie o cerere JSON care numește sursele, semnalele, ferestrele de măsurare, alinierea, criteriile, regula de decizie și incertitudinea, iar programul face munca: importă datele, normalizează unitățile și semnele, măsoară RMS, frecvența, factorul de umplere, timpii de creștere și de cădere, supracreșterea, stabilizarea, riplul și întârzierea, aliniază seriile după markeri declarați sau prin corelație încrucișată limitată și decide fiecare criteriu ca trecut, picat sau incomplet. Raportul, cu suprapuneri, diferențe, condiții și legături către surse, ajunge în `embedded-lab-results/<run-id>/` din workbench.

## Ce necesită

- **lab-validate**: un script pe biblioteca standard Python, instalat automat de **Instalează dependențele** de pe pagina pluginului.
- Datele din workbench: foldere de captură scpi-instruments, fișiere CSV, exporturi CSV sigrok-cli sau foldere de rulări tranzitorii ngspice ori LTspice. Pluginurile SPICE nu trebuie să fie instalate pentru a le citi folderele de rulare. Formatele proprietare brute (`.sr`, `.raw`, fișiere binare de osciloscop) trebuie convertite mai întâi cu propriul lor instrument.
- Limitele cerinței așa cum sunt scrise, plus incertitudinea și banda instrumentului pe care le poți justifica pentru montajul tău.
- Fără pluginuri necesare, hardware sau parametri de configurare.

## Cum se folosește

- „Ce conține captura din embedded-lab-results/cap1?”
- „Verifică timpul de creștere și riplul capturii de osciloscop față de REQ-PWR-12.” (skill-ul `validation-planning`)
- „Compară ieșirea măsurată cu rularea ngspice, aliniate pe frontul crescător al intrării.”
- „De ce este criteriul C2 incomplet?” (skill-ul `difference-explanation`)
- „Rezumă aceste rulări de comparație într-un singur verdict de campanie.”

Agentul nu calculează niciodată singur o metrică sau un verdict și citează doar ce raportează programul. Nu lărgește o limită, o fereastră sau o toleranță ca să obțină o trecere. Diferențele dintre măsurare și simulare sunt prezentate ca ipoteze legate de dovezile din rezultat.

## Risc și aprobări

Fiecare comandă a acestui plugin este sigură și rulează fără să întrebe în orice mod de permisiuni, inclusiv Doar citire. Citește fișiere din workbench fără să le modifice, nu deschide nicio conexiune de rețea, nu pornește alt program și creează doar foldere noi de rulare. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64.
- Un rezultat nu este o calibrare sau o certificare metrologică; lab-validate nu derivă incertitudinea.
- Golurile, saturarea, aliasingul evident, banda necunoscută sau insuficientă și condițiile lipsă sau diferite fac un criteriu incomplet. Incomplet nu înseamnă aproape trecut.
- Ceasurile instrumentelor diferite nu sunt niciodată sincronizate după timpii fișierelor; alinierea folosește markeri declarați, offset-uri sau corelație încrucișată.
