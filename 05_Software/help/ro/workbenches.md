# Workbench-uri

Un workbench este un folder de proiect în care lucrează VERA: surse, fișe tehnice, scheme, jurnale și notițe. VERA își păstrează propriile date pentru folder într-un subfolder `.vera/` și nu mută și nu convertește celelalte fișiere ale tale. Fiecare workbench are propriile sesiuni, propriul index de documente, propriile instrucțiuni și propriile pluginuri activate.

## Creează un workbench

1. Selectează **Workbench nou** în bara laterală.
2. La **General**, selectează **Alege folderul** și alege folderul. **Numele workbench-ului** se completează din numele folderului; îl poți schimba dacă vrei.
3. La **Documente și RAG**, verifică folderele de documentație găsite de VERA sau selectează **Adaugă folder…**. Linia de previzualizare arată câte documente vor fi indexate. **Avansat: pattern-uri de includere și excludere** îți permite să editezi direct pattern-urile.
4. Opțional, ajustează celelalte secțiuni (vezi tabelul de mai jos).
5. Selectează **Creează un workbench** din dreapta sus.

Dacă folderul este deja un workbench, VERA oferă în schimb **Deschide acest workbench**. Un fișier `.vera/WORKBENCH.md` existent este păstrat neschimbat.

Folosește un folder de pe un disc local. Folderele partajate în rețea nu sunt acceptate.

## Workbench-uri deschise, recente și fixate

- **Deschide workbench** deschide un folder care conține deja `.vera/workbench.yaml`.
- Bara laterală listează workbench-urile recente. Workbench-urile fixate rămân în partea de sus.
- Fiecare rând are un meniu **Acțiuni workbench**: **Fixează** sau **Anulează fixarea**, **Mută mai sus**, **Mută mai jos**, **Editează workbench-ul**, **Deschide în Explorer**, **Închide workbench-ul** și **Elimină din listă**.
- **Elimină din listă** elimină doar intrarea; niciun fișier nu este șters.
- Dacă un folder a fost mutat sau șters, intrarea sa afișează **Folder lipsă**. Elimină-l din listă sau deschide folderul din noua locație.
- **Arată sesiunile** și **Ascunde sesiunile** extind sau restrâng sesiunile unui workbench în bara laterală.

Selectează numele unui workbench pentru a vedea **Prezentare workbench**: modelul de conversație, modul de permisiuni, sursele indexate și excluse și sesiunile.

## Editează un workbench

Selectează **Editează workbench-ul** în prezentare sau în meniul rândului. Modifică secțiunile, apoi selectează **Salvează** din dreapta sus; **Anulează** renunță la modificări. Dacă pleci cu modificări nesalvate, VERA te întreabă mai întâi.

| Secțiune | Ce setează |
|---|---|
| **General** | Numele și descrierea |
| **Interfață** | Vizibilitatea pentru **Filele panoului din dreapta** |
| **Documente și RAG** | Ce foldere și fișiere sunt indexate |
| **Agent și chat** | Modelul implicit, modul de permisiuni implicit, **Nivel de detaliu** |
| **Instrucțiuni** | Textul din `.vera/WORKBENCH.md`, pe care agentul îl citește în fiecare sesiune |
| **Instrumente** | Ce instrumente integrate poate folosi agentul |
| **Skill-uri** | Skill-urile workbench-ului și ale utilizatorului: activează-le, creează-le și editează-le |
| **Indexare** | Setările de embedding și valorile implicite ale căutării agentului în documente |
| **Pluginuri** | Ce pluginuri instalate activează acest workbench |

Păstrează instrucțiunile scurte și factuale: placa, microcontrolerul, toolchainul, convențiile. Doar primii 16 KB ajung la agent; VERA te avertizează când textul este mai lung.

## Filele panoului din dreapta

Deschide **Editează workbench-ul > Interfață > Filele panoului din dreapta**. Alege filele vizibile: Instrucțiuni și skill-uri, Fișiere, Modificări, Artefacte, Plan, Rulări și Terminal. Implicit sunt selectate toate. **Restabilește valorile implicite** le selectează în ciornă; **Salvează** aplică selecția, iar **Anulează** o abandonează.

Salvarea actualizează imediat toate sesiunile acestui workbench, inclusiv după redeschidere sau repornirea VERA. Alte workbench-uri își păstrează propriile selecții. Dacă ascunzi fila activă, este selectată prima filă rămasă în ordinea obișnuită. Dacă le ascunzi pe toate, panoul se închide și butonul obișnuit de deschidere dispare. **Filele panoului din dreapta** rămâne accesibil pe pagina principală, iar editorul rămâne disponibil din prezentarea workbench-ului și meniul lateral.

Săgețile, Home și End parcurg doar filele vizibile. Comanda rapidă a terminalului nu dezvăluie o filă ascunsă, ci oferă acces la aceste setări. Ascunderea schimbă doar afișarea: instrucțiunile, fișierele, modificările, artefactele, planurile și istoricul se păstrează; instrumentele agentului funcționează în continuare, iar terminalele și programele active nu sunt oprite. Închide rămâne disponibil când panoul este afișat și nu este o filă configurabilă.

## Workbench-uri doar pentru citire

Un workbench se deschide doar pentru citire atunci când un alt proces VERA îl are deja deschis, de exemplu o a doua instalare VERA. Poți citi sesiunile, răsfoi și deschide fișiere și exporta sesiuni, dar nu poți trimite mesaje și nu poți salva setări. Închide cealaltă instanță și deschide din nou workbench-ul pentru a lucra în el.

## Folderul .vera

| Element | Conținut |
|---|---|
| `workbench.yaml` | Configurația workbench-ului; editeaz-o prin **Editează workbench-ul** |
| `WORKBENCH.md` | Instrucțiunile pentru agent |
| `.veraignore` | Reguli opționale pentru fișierele pe care agentul și indexul nu trebuie să le vadă |
| `skills/` | Skill-urile acestui workbench |
| `plugins/` | Pachete de pluginuri partajate cu proiectul |
| `vera.db` | Sesiuni, aprobări, modificări și indexul documentelor |
| `artifacts/`, `downloads/`, `runs/` | Artefactele sesiunilor, fișierele descărcate, jurnalele rulărilor de programe |

`.vera/` conține un `.gitignore` care păstrează sub controlul versiunilor doar configurația, instrucțiunile, `.veraignore` și skill-urile. Agentul nu poate modifica `workbench.yaml` sau `.vera/plugins`, în niciun mod de permisiuni.

`.veraignore` folosește aceeași sintaxă de pattern-uri ca `.gitignore`. Folderele `.vera`, `.git` și `node_modules` sunt ignorate întotdeauna.

## Foldere suplimentare

În **Editare workbench > General > Foldere suplimentare**, alege **Adaugă folder** și selectează un folder absolut, de exemplu un depozit alăturat. **Salvează** acordă acces; **Anulează** renunță la selecție. Prezentarea generală listează folderele salvate. Elimină un folder și salvează pentru a revoca imediat accesul, inclusiv pentru operații în așteptare. Workbench-urile doar în citire nu pot schimba aceste permisiuni.

Instrumentele obișnuite read, list, glob, grep, write și edit și directoarele comenzilor shell pot folosi aceste foldere cu aceleași aprobări Întreabă sau Editare automată ca workbench-ul. Folosește căi absolute pentru fișiere externe; căile relative pornesc din workbench-ul principal. Sursele externe au identități absolute, fără citări locale de documente. Regulile de ignorare rămân active, iar datele VERA sunt refuzate și prin legături. Adăugarea nu indexează folderele: indexul, jurnalele, artefactele și datele generate rămân în workbench-ul principal. Comenzile păstrează drepturile contului sistemului, fără sandbox.

## Date și confidențialitate

Alege Implicit, Activat sau Dezactivat pentru fiecare zonă de mascare, apoi Salvează sau Anulează în dreapta sus. Implicit arată și urmează valoarea aplicației; alegerile rămân independente între workbench-uri. Vezi [Setări](settings.md) pentru avertizarea despre furnizorul modelului și limitele istoricului salvat.
