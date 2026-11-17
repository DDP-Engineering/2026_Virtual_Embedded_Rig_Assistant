# Documente și căutare

VERA indexează documentația unui workbench pe calculatorul tău, astfel încât agentul să poată căuta în ea și să citeze exact pagina, secțiunea sau linia pe care a folosit-o. Indexarea folosește un model local și nu trimite nimic prin rețea. Când agentul citește un pasaj pentru a-ți răspunde, acel pasaj ajunge la furnizorul tău de modele, la fel ca restul conversației; cu un server local precum LM Studio sau Ollama, rămâne pe calculatorul tău.

Mascarea afișării este dezactivată implicit. Când este activată pentru un workbench, secretele salvate din numele fișierelor și textul vizualizatorului apar ca [REDACTED]. Fișierele și rezultatele căutării rămân în listă și deschid același fișier, chiar dacă două nume mascate arată identic. Mascarea afișării nu schimbă indexarea sau ce poate trimite agentul unui model. Imaginile paginilor PDF păstrează octeții originali; se maschează doar textul extras.

## Ce se indexează

Se indexează folderele bifate la **Editează workbenchul** → **Documente și RAG**, ținând cont de pattern-urile de includere și excludere de la **Avansat: pattern-uri de includere și excludere**. Se indexează aceste tipuri de fișiere:

- PDF
- Markdown, HTML și text (`.txt`, `.csv`, `.tsv`)
- Fișiere Word, PowerPoint și Excel în formatele moderne (`.docx`, `.pptx`, `.xlsx`) și echivalentele lor OpenDocument (`.odt`, `.odp`, `.ods`)

Fișierele vechi `.doc`, `.ppt`, `.xls` și RTF nu sunt indexate; salvează-le într-un format modern. Fișierele care se potrivesc cu `.vera/.veraignore` și tot ce se află în `.vera`, `.git` sau `node_modules` nu sunt indexate niciodată. Nici codul sursă și jurnalele nu sunt indexate; agentul le citește direct cu instrumentele sale pentru fișiere.

Cu **Folosește .gitignore** bifat (implicit pentru workbenchurile noi), nici fișierele și folderele excluse de fișierele `.gitignore` ale workbenchului nu sunt indexate: cel din folderul workbenchului și cele din subfoldere, fiecare pentru folderul său, ca în Git. O linie care începe cu `!` în `.vera/.veraignore` readuce un fișier sau un folder exclus de `.gitignore`, cu tot conținutul lui; `.vera`, `.git` și `node_modules` rămân ignorate. Instrumentele agentului pentru fișiere citesc în continuare fișierele excluse doar de `.gitignore`.

Indexarea rulează în fundal și urmărește modificările: fișierele noi, modificate și șterse sunt preluate automat.

## Starea indexului

Fila **Fișiere** din panoul din dreapta arată progresul (**Index: … finalizate, … în așteptare, … eșuate**) și marchează fiecare document:

| Stare | Semnificație |
|---|---|
| **Indexat** | Poate fi căutat |
| **În așteptare** | Așteaptă să fie indexat |
| **Eșuat** | Nu a putut fi citit sau procesat; motivul este afișat, de exemplu **Limită de dimensiune depășită** |
| **Neacceptat** | Nu este un tip acceptat sau depășește limita de dimensiune (**Limită de dimensiune depășită**) |
| **Necesită OCR** | Un PDF scanat fără strat de text; VERA nu rulează OCR |

Se indexează fișiere PDF și Office de până la 100 MiB și fișiere text de până la 20 MiB. **Dimensiune maximă fișier (MB)** de la **Editează workbenchul** → **Documente și RAG** coboară aceste limite pentru workbench (1 MB = 1.048.576 octeți); nu le crește niciodată. Lasă câmpul gol pentru a le păstra. **Reindexează** indexează din nou workbenchul. Dacă indexarea s-a oprit după eșecuri repetate, selectează **Repornește indexarea**.

**Număr maxim de fișiere indexate** de la **Editează workbenchul** → **Documente și RAG** (implicit 10.000) protejează de o selecție neașteptat de mare. Când sunt selectate mai multe documente, indexarea nu pornește: fila **Fișiere** arată numărul, cele zece foldere cu cele mai multe documente selectate (inclusiv subfolderele), **Indexează oricum** și **Editează excluderile**. Între timp nimic nu este indexat, modificat sau eliminat, iar indexarea nu ia niciodată doar o parte din selecție. **Indexează oricum** le indexează pe toate și reține numărul; o selecție ulterioară cu până la 20 % mai mare continuă indexarea, una mai mare o oprește din nou. **Editează excluderile** deschide **Documente și RAG** pentru a restrânge selecția.

Numărul de documente din **Workbench nou** și **Documente și RAG** se calculează cu aceleași reguli ca indexarea (fișiere de ignorare, limitele de dimensiune și de număr de fișiere), deci corespunde cu ce se indexează. Când selecția depășește **Număr maxim de fișiere indexate**, avertismentul apare acolo înainte de salvare. Pe un folder foarte mare numărarea se oprește după 5 secunde; numărul apare atunci ca „cel puțin”.

La **Editează workbenchul** → **Indexare**, **Căutare în documente** setează valorile implicite ale agentului: **Rezultate per căutare (1–20)** și **Mod de căutare**: **Hibrid (cuvinte cheie și sens)**, **Doar cuvinte cheie** sau **Doar după sens**.

## Fila Fișiere

Fila **Fișiere** afișează întregul folder al workbenchului ca arbore. Fișierele ignorate de VERA sunt afișate cu caractere cursive. Caseta **Caută fișiere și documente** filtrează arborele după numele fișierului și listează la **În documente** pasajele potrivite din documentele indexate.

Meniul unui fișier oferă **Deschide**, **Atașează ca context**, **Deschide în** (aplicația implicită sau altă aplicație), **Arată în Explorer** (Finder sau folderul pe alte sisteme), **Copiază** (calea absolută, calea relativă sau numele fișierului) și **Proprietăți**, care include starea indexării.

## Citări

Într-un răspuns, fiecare etichetă de citare numește sursa și locul: pagina, intervalul de pagini, slide-ul, titlul sau intervalul de linii. Selectează o etichetă pentru a deschide documentul în acel loc. O etichetă marcată **Citarea nu a putut fi verificată** indică ceva ce VERA nu a putut confirma, de exemplu o pagină care nu există sau un fișier care s-a modificat între timp; tratează acea afirmație cu precauție.

## Vizualizatorul de documente

Documentele se deschid ca file lângă fila **Chat**, așa că conversația rămâne unde era. Poți comuta liber între ele.

Fișierele text oferă **Codificare** și **Încadrare pe rânduri**. Marcajele BOM UTF-8 și UTF-16 sunt detectate; fără BOM se folosește UTF-8. Alege Windows-1252, ISO-8859-1, ISO-8859-2 sau UTF-16 LE/BE când este nevoie. Chromium decodează ISO-8859-1 prin aliasul Windows-1252. **Afișează ca text** arată octeții invalizi ca semne de înlocuire. Căutarea și saltul la linie folosesc liniile sursă numerotate chiar și cu încadrarea activă. Aceste controale nu modifică fișierul, indexarea sau verificarea citărilor. Cu mascarea afișării activă, textul obișnuit înlocuiește octeții secreți cu asteriscuri (perechile UTF-16 apar ca ⨪); numele și textul citărilor folosesc [REDACTED].

Fișierele mari sunt citite în ferestre. Bara din dreapta selectează poziția în octeți; bara interioară derulează fereastra curentă. Ctrl+Home/End ajunge la începutul/sfârșitul fișierului. Numerele cu ≈ sunt estimări până la finalizarea indexării progresive. Saltul la linie este întâi aproximativ, apoi exact. Căutarea parcurge ferestrele; Enter caută următoarea potrivire, Shift+Enter pe cea anterioară, iar **Anulează** oprește scanarea. Liniile foarte lungi apar în fragmente limitate, marcate cu …; derularea continuă în fragmentul următor. Căutarea numără liniile sursă potrivite și revine la început sau sfârșit. Citatele mari păstrează intervalul verificat.

- Fișierele PDF se derulează continuu și afișează numărul paginii. Mărește sau micșorează cu Ctrl+rotița mouse-ului sau cu Ctrl+= , Ctrl+- și Ctrl+0.
- Ctrl+F caută text într-un PDF sau într-un document text; în fișierele text, Ctrl+G sare la o linie.
- Ctrl+Tab și Ctrl+Shift+Tab comută între file, Ctrl+W închide fila curentă, iar Escape revine la **Chat**.
- Meniul unei file oferă **Închide**, **Închide celelalte**, **Închide la dreapta**, **Mută la stânga** și **Mută la dreapta**. Filele pot fi și trase cu mouse-ul.

## Descărcări

Cu **Acces web** activat, agentul poate descărca un fișier public în `.vera/downloads/` al workbenchului. În **Întreabă** și **Editare automată**, cere mai întâi aprobare și afișează adresa sursei și dimensiunea maximă. Un PDF descărcat primește un card **Deschide PDF** în conversație și apare la **Fișiere descărcate** în fila **Fișiere**. Descărcările nu sunt indexate automat; pentru ca o descărcare să poată fi căutată, copiaz-o într-un folder indexat. Vezi [Setări](settings.md) pentru accesul web și [Permisiuni](permissions.md) pentru aprobări.
