# Scheme QElectroTech

Scheme QElectroTech îi permite agentului să citească proiectele QElectroTech (.qet) și să lucreze cu ele alături de modelul electric al proiectului. Listează foile, aparatele cu contactele lor legate și referințele încrucișate, potențialele unite de conductoare și pune aparatele în corespondență cu referințele modelului. Pentru un motor cu un rezultat curent de pornire, propune o schemă pe două foi (circuit de forță și de comandă) din șablonul DOL, inversare sau stea-triunghi și o verifică înainte de aprobare. De asemenea, reetichetează elemente într-un proiect existent și salvează o verificare a numerotării, a referințelor încrucișate și a listei aparatelor.

## De ce are nevoie

- **Niciun program.** Agentul folosește instrumentele integrate VERA `qelectrotech`, `qelectrotech_change` și `qelectrotech_check`, oferite doar cât timp acest plugin este activat. Nu este nimic de instalat sau descărcat, deci **Install dependencies** nu are nimic de făcut aici.
- QElectroTech (testat cu 0.100 pe Windows și 0.90 pe Ubuntu) pentru a deschide, inspecta, numerota și salva proiectele. VERA nu îl pornește niciodată: QElectroTech nu are export din linia de comandă.
- Pentru un candidat: un rezultat curent de pornire a motorului (pluginul Pornirea motoarelor și variatoare) cu metoda DOL, inversare sau stea-triunghi.

## Cum îl folosiți

- „Citește schematics/plant.qet și listează foile și eventualele probleme.” (skill `qelectrotech-schematics`)
- „Ce contacte aparțin lui KM1 și pe ce foaie și coloană sunt?”
- „Propune schema stea-triunghi pentru pompa M2 din ultimul rezultat al motorului.”
- „Redenumește KM1 în KM10 în proiectul pe care tocmai l-am salvat.”
- „Verifică numerotarea și referințele încrucișate și compară lista aparatelor cu modelul.”
- „Înregistrează aparatele QElectroTech în modelul electric.”

Candidații sunt fișiere noi. Un rezultat de verificare se salvează în `electrical-automation-results/<run-id>/` cu hash-ul fișierului proiectului; dacă modelul se schimbă, este marcat ca vechi.

## Risc și aprobări

`qelectrotech` doar citește. `qelectrotech_change` și `qelectrotech_check` sunt instrumente de scriere: cer aprobarea ca o scriere de fișier și nu sunt oferite în sesiunile Read-only. Un candidat nu se scrie niciodată peste un fișier existent; o modificare numește hash-ul fișierului citit și eșuează dacă fișierul s-a schimbat între timp, astfel nimic din ce ați salvat în QElectroTech nu este suprascris. Se schimbă doar textele modificate; ceilalți octeți rămân. Modelul electric se schimbă doar prin instrumentul modelului, cu aprobarea dvs. Nu există acțiuni device-read, device-write sau ireversibile.

## Limite

- Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Fișierele cu declarație de tip de document sau entități sunt refuzate (protecție împotriva entităților XML externe).
- O interblocare electrică contează doar ca un contact NC pe fiecare cale spre bobină; o interblocare mecanică provine din rezultatul de pornire, niciodată din desen. Șabloanele pentru softstarter și variator nu fac parte din această versiune.
- Alimentarea de comandă, butoanele și releul de timp din șabloane sunt propuneri pe care le confirmați. Numerotarea conductoarelor rămâne deschisă până le numerotați în QElectroTech.
- Nicio imagine sau PDF nu este convertit într-o schemă.
- Rezultatele sunt suport ingineresc preliminar: nu un proiect verificat, nu o declarație de conformitate și nu se pretinde nicio funcție de siguranță.
