# Primii pași

Această pagină te duce de la prima pornire la un prim răspuns cu citări. Durează câteva minute, plus timpul de care VERA are nevoie pentru a-ți indexa documentele.

## De ce ai nevoie

- VERA instalat pe Windows x64 sau Linux x64. Fără rețea, vezi [Instalare offline](offline-install.md).
- Acces la un model AI: o cheie API OpenAI, un abonament ChatGPT sau un server local de modele, cum ar fi LM Studio sau Ollama.
- Un folder de proiect pe un disc local, ideal împreună cu documentația sa (fișe tehnice, manuale de referință, scheme în format PDF, notițe în Markdown).

## Prima pornire

VERA se deschide pe **Acasă**, care îți afișează **Workbench-uri** și oferă **Creează un workbench**. Bara laterală conține **Workbench nou**, **Deschide workbench** și **Pluginuri**; **Setări** se află în partea de jos a barei laterale.

Pentru a schimba mai întâi limba interfeței, deschide **Setări** → **Aspect și limbă** și alege o valoare la **Limba interfeței**.

## Pasul 1: conectează un furnizor

1. Deschide **Setări** → **Furnizori**.
2. Alege una dintre variante:
   - Abonament ChatGPT: selectează **Adaugă furnizor**, alege **Abonament ChatGPT** ca **Furnizor**, selectează **Autentificare cu ChatGPT** și finalizează autentificarea în browser.
   - Cheie API sau server local: selectează **Adaugă furnizor**, alege **Furnizor** (**API OpenAI**, LM Studio, Ollama sau **Alt furnizor compatibil**), completează câmpurile și selectează **Salvează**.
3. Selectează **Testează** lângă conexiune. Toți cei patru pași (**Conectivitate**, **Autentificare și model**, **Apelare instrumente**, **Streaming**) ar trebui să afișeze **Reușit**.

Detaliile sunt în [Furnizori și modele](providers.md).

## Pasul 2: creează un workbench

1. Selectează **Workbench nou**.
2. Selectează **Alege folderul** și alege folderul proiectului. Numele se completează din numele folderului.
3. La **Documente și RAG**, verifică folderele de documentație găsite de VERA sau folosește **Adaugă folder…**.
4. Selectează **Creează un workbench**.

VERA deschide o sesiune cu caseta de mesaj focalizată și începe indexarea în fundal. Poți folosi deja chatul; bara din **Fișiere** indică activitatea, iar prezentarea generală a workbench-ului arată progresul detaliat. Vezi [Workbench-uri](workbenches.md) și [Documente și căutare](documents-and-search.md).

## Pasul 3: pune o primă întrebare

1. Folosește sesiunea deschisă odată cu workbench-ul. Pentru altă conversație, selectează **Sesiune nouă**.
2. În controalele casetei de mesaj, alege un **Model**. Deocamdată lasă modul de permisiuni pe **Întreabă**.
3. Scrie o întrebare despre proiect, de exemplu „Care este frecvența maximă de ceas SPI a senzorului și ce pini folosește?”, și apasă Enter.

Agentul caută în documente, citește paginile relevante și răspunde. Etichetele de citare din răspuns numesc sursa; selectează una pentru a deschide documentul la pagina, titlul sau linia citată.

Dacă agentul vrea să modifice un fișier sau să ruleze un program, îți cere mai întâi acordul printr-un card de aprobare. Vezi [Permisiuni](permissions.md).

## Pașii următori

- Lasă agentul să lucreze cu instrumentele de pe bancul tău de lucru: [Pluginuri](plugins.md).
- Află cum funcționează sesiunile, ghidarea și exportul: [Chat și sesiuni](chat-and-sessions.md).
- Ajustează dimensiunile textului, tema și actualizările: [Setări](settings.md).
