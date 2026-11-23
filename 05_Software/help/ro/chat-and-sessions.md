# Chat și sesiuni

O sesiune este o conversație cu agentul în cadrul unui workbench. VERA salvează fiecare sesiune în workbench, așa că poți închide aplicația și continua mai târziu. Mai multe sesiuni pot rula în același timp. Cel mult trei ture rulează simultan în toate workbench-urile deschise, sau câte sunt setate la **Ture simultane** în [Setări avansate](advanced-settings.md); un mesaj trimis la limită rămâne netrimis în caseta de mesaj până se termină o tură.

## Pornește și gestionează sesiuni

- **Sesiune nouă** pornește o conversație în workbench-ul deschis. Dacă există o sesiune goală nefolosită, VERA o deschide pe aceea în loc să creeze alta.
- Primul mesaj devine titlul. **Redenumește** setează un titlu ales de tine.
- **Caută sesiuni** găsește sesiuni după titlu și după textul mesajelor.
- Fiecare rând de sesiune afișează ora ultimei activități și are un meniu cu **Exportă Markdown**, **Exportă JSON**, **Redenumește**, **Mută mai sus**, **Mută mai jos**, **Arhivează** și **Șterge**.
- O sesiune își afișează starea: **Inactiv**, **În lucru**, **Așteaptă aprobare** sau **Eroare**. O sesiune în lucru are un semn care se rotește lângă oră, iar una care așteaptă aprobare un scut.

## Sesiuni din alte workbench-uri

Turele continuă să ruleze când deschizi alt workbench. Rândul unui workbench din bara laterală afișează un semn cu numărul sesiunilor în lucru și al celor care așteaptă, chiar și când rândul este restrâns; un scut înseamnă că o sesiune așteaptă aprobarea ta. Selectează semnul (sau focalizează-l și apasă Enter) pentru a vedea aceste sesiuni. Alege o sesiune pentru a o deschide în workbench-ul ei, unde poți verifica aprobarea, sau **Oprește** pentru a încheia doar acea tură. Cât timp rulează ture, **Workbench-uri** arată câte rulează și limita **Ture simultane**. La limită, un mesaj nou rămâne în caseta de mesaj: așteaptă să se termine o tură sau oprește una din bara laterală, apoi trimite-l din nou.

## Scrie un mesaj

Scrie în caseta de mesaj (**Întreabă VERA despre proiect…**). Enter trimite, Shift+Enter adaugă un rând, iar @ completează căile fișierelor din workbench. Pentru a-i da agentului un fișier, alege **Atașează ca context** pe acel fișier în fila **Fișiere**; fișierul apare ca etichetă deasupra casetei de mesaj.

Lângă caseta de mesaj alegi **Model**, **Nivel de reasoning** și **Mod de permisiuni** pentru această sesiune. Sesiunile noi preiau modelul și modul de permisiuni din setările workbench-ului.

Lipește sau trage o imagine în caseta de mesaj sau alege **Atașează imagine** pentru a selecta un fișier. În Fișiere, trage imaginea în caseta de mesaj sau alege **Atașează imagine** din meniul ei. Elimină imaginea cu butonul de pe miniatură. VERA păstrează fișierele importate originale în workbench. Imaginile atașate din Fișiere își păstrează căile.

Selectează miniatura dintr-un mesaj trimis pentru a deschide imaginea în vizualizatorul de fișiere. Dacă imaginea lipsește, mesajul afișează calea salvată în workbench.

Un mesaj poate indica până la opt imagini PNG, JPEG, GIF sau WebP din workbench, cu o limită de 20 MiB pe fișier. VERA redimensionează copia trimisă unui model care acceptă imagini la cel mult 2048 de pixeli pe latura lungă și păstrează fișierul original. Un model care acceptă doar text primește căile. Compactarea păstrează căile imaginilor mai vechi în note text. Exporturile sesiunii includ aceste căi.

Vezi [Furnizori și modele](providers.md) pentru a afla cum stabilește VERA dacă modelul ales acceptă imagini.

Pentru ca agentul să examineze o imagine din workbench, indică-i calea relativă. Cu un model care acceptă imagini, agentul poate folosi `view_image` pentru fișiere PNG, JPEG, GIF sau WebP de până la 20 MiB. Latura cea mai lungă a copiei trimise modelului are cel mult 2048 de pixeli. Instrumentul cere o cale permisă din workbench, fără linkuri, inclusiv în modul Bypass. Rezultatul din istoricul sesiunii păstrează calea. Comutatorul apare în **Editează workbench-ul** → **Instrumente** dacă modelul implicit al workbench-ului acceptă imagini.

Agentul poate redeschide o imagine trimisă din caseta de mesaj a acestei sesiuni folosind calea salvată. Poate examina până la opt imagini într-un pas și păstrează în turul curent ultimele opt imagini obținute cu instrumentul.

## Dictează un mesaj

Alege un model din [Setări > Dictare](settings.md). În modul cu apăsare continuă, ține apăsat butonul microfonului sau comanda configurată. Cu butonul focalizat, ține apăsată tasta Spațiu sau Enter. Eliberează pentru transcriere. În modul pornire/oprire, apasă o dată pentru înregistrare și din nou pentru transcriere. Escape sau Anulează dictarea renunță la înregistrare ori transcriere și lasă agentul să continue. Dacă părăsești chatul sau fereastra pierde focalizarea, dictarea se anulează.

Rezultatul apare la cursorul inițial sau după textul selectat. Dacă ai editat mesajul în timpul dictării, rezultatul se adaugă la final. Textul și atașamentele se păstrează. Verifică textul și trimite-l cu Enter sau Trimite.

## Ghidează sau oprește o execuție în curs

Cât timp agentul lucrează, poți continua să scrii și să trimiți mesaje, de exemplu „verifică și errata”. Acestea afișează **În așteptarea livrării** până când agentul le preia la pasul următor. Cât timp un card de aprobare așteaptă decizia ta, trimiterea este suspendată.

**Oprește** încheie execuția curentă. Și Escape întreabă **Oprești execuția curentă?**. Lucrul deja finalizat, cum ar fi modificările de fișiere aplicate, rămâne.

## Urmărește sesiunile delegate

Când VERA deleagă o sarcină, **Sesiuni delegate** din chatul părinte afișează fiecare sesiune copil și starea sa. Selectează o sesiune copil pentru a-i deschide fila Chat și a-i urmări conversația. **Sesiune părinte** revine la sesiunea părinte.

Pentru a opri o sesiune copil în curs, deschide-o și folosește **Oprește** lângă câmpul pentru mesaje. Sesiunea părinte poate continua. Dacă se cere aprobare, folosește cardul de aprobare din sesiunea respectivă. Când redeschizi oricare dintre sesiuni după repornirea VERA, legătura și rezultatul execuției delegate rămân disponibile.

Agentul părinte poate trimite instrucțiuni noi în aceeași conversație copil și îi poate alege modelul și nivelul de raționament pentru rundele următoare. Mesajele sunt etichetate **Instrucțiune de la agentul părinte**. Dacă sesiunea copil este activă, o instrucțiune eligibilă așteaptă următoarea cerere către model. Folosește cardul de aprobare din sesiunea copil când este necesară o decizie a utilizatorului.

O sesiune copil nouă pornește în modul de permisiuni curent al sesiunii părinte. După lansare, alege separat modul fiecărei sesiuni în câmpul ei de compunere. Pentru un părinte în Bypass, alege **Permite acces complet pentru noile sesiuni copil** și confirmă lansările eligibile viitoare. Pentru a retrage autorizarea, alege **Revocă accesul complet la lansările viitoare**. Sesiunile copil existente își păstrează modul. Pentru a limita accesul unei sesiuni copil, schimbă modul în chatul ei. Publicarea la distanță necesită permisiune separată.

Într-o copie de lucru partajată, lasă o sesiune copil să termine implementarea și verifică predarea înainte de a porni următoarea.

Într-o sesiune delegată în Bypass, comenzile shell rulează automat dacă se potrivesc unui prefix salvat de utilizator în workbench. Pentru celelalte comenzi, ți se cere aprobarea.

## Niveluri de detaliu

**Nivel de detaliu** se setează pentru fiecare workbench în **Editează workbench-ul** → **Agent și chat**:

| Nivel | Ce afișează conversația |
|---|---|
| **Verbose** | Fiecare apel de instrument cu argumentele și rezultatul său, raționamentul modelului și, sub fiecare mesaj al tău, data și ora trimiterii și statisticile de tokenuri |
| **Normal** | Apelurile de rutină ale instrumentelor, grupate într-o linie extensibilă **Operații** |
| **Minimal** | Doar conversația; apelurile de rutină ale instrumentelor sunt ascunse, iar un indicator de lucru este afișat cât timp agentul lucrează |

Aprobările care te așteaptă, erorile și cardurile de descărcare sunt afișate la orice nivel; aprobările acordate de modul de permisiuni sunt ascunse la **Minimal** și grupate la **Normal**. Nivelul schimbă doar afișarea; sesiunea salvată și exporturile ei sunt întotdeauna complete.

Activitatea instrumentelor arată pe scurt acțiunea, fișierul, pagina sau comanda vizată și starea. Extinde operația pentru rezultat sau pentru comanda exactă și folderul de lucru. **Detalii tehnice** conține numele instrumentului, durata, argumentele originale și rezultatul brut; fragmentele mari salvate pot fi încărcate integral. Un cod de ieșire diferit de zero apare ca eroare, iar rulările în fundal au o etichetă distinctă. Nivelurile de detaliu și cererile de aprobare își păstrează comportamentul. Operațiile de actualizare a planului arată pașii efectivi și starea lor la extindere; detaliile tehnice sunt opționale și separate.

## Raționament

Pentru modelele care îl acceptă, **Nivel de reasoning** oferă **Implicit** și nivelurile declarate de model, de exemplu **Minim**, **Redus**, **Mediu**, **Ridicat** sau **Maxim**. Nivelurile mai ridicate gândesc mai mult înainte de a răspunde. Pentru modelele fără niveluri de raționament, controlul este ascuns. Îl poți schimba în timpul unei execuții; noul nivel se aplică următoarei cereri. Textul raționamentului este afișat doar la **Verbose**.

## Sesiuni lungi și context

Indicatorul de context afișează **Context utilizat** ca procent din fereastra de context a modelului; selectează-l pentru utilizare și limite. Când o sesiune devine prea lungă pentru model, VERA rezumă istoricul mai vechi (**Se rezumă istoricul…**). Între timp indicatorul se rotește și păstrează ultimul procent, care se actualizează când următoarea cerere este pregătită. Transcriptul complet rămâne salvat și vizibil.

**Caută în conversație** caută în sesiunea curentă. Banda de marcaje de la marginea stângă a conversației are câte un marcaj pentru fiecare mesaj al tău; indică un marcaj pentru a previzualiza mesajul și selectează-l pentru a sări la el.

## Arhivează, șterge și exportă

- **Arhivează** mută o sesiune încheiată în **Sesiuni arhivate**; **Restaurează** o readuce. Nu se pierde nimic.
- **Șterge** elimină sesiunea și artefactele ei după o confirmare. Fișierele descărcate de agent rămân în workbench.
- **Exportă Markdown** scrie un transcript lizibil cu rezumate ale instrumentelor, citări și modificări aplicate; **Exportă JSON** scrie înregistrarea completă a evenimentelor. Ambele deschid un dialog de salvare și funcționează și în workbench-urile doar pentru citire.

Marcajele salvate ale mesajelor rămân în exporturile JSON; Markdown indică mesajele utilizatorului cu marcaj. Marcajele aparțin sesiunii și nu sunt trimise agentului.

## Panoul din dreapta

**Arată sau ascunde panoul din dreapta** afișează file pentru sesiunea deschisă: **Instrucțiuni și skill-uri** (instrucțiunile workbench-ului și skill-urile disponibile), **Fișiere**, **Modificări**, **Artefacte** (rezultatele text salvate de agent, cu **Exportă** și **Arată în folder**), **Plan** (lista de sarcini a agentului) și **Rulări** (rulările de programe ale pluginurilor).

Selectează o editare din **Modificări** pentru a-i deschide diferențele într-un tab lângă Chat.

## Feedback și revizuirea planului

În **Plan**, alege **Adaugă comentariu** pentru un pas întreg sau selectează mai întâi text dintr-un singur pas pentru a cita fragmentul. Cu tastatura, selectează cu Shift și săgețile în **Textul pasului**, apoi alege **Folosește textul selectat**; **Întregul pas** elimină fragmentul. Pașii goi acceptă doar comentarii pentru întregul pas. Scrie feedback pe mai multe rânduri, de exemplu „Verifică tensiunea înainte de programare”, și alege **Salvează schița**. Salvarea nu trimite mesaje și nu pornește agentul. Anulare sau Escape renunță la editările nesalvate și readuce focalizarea în Plan.

Numărul schițelor și al comentariilor trimise deschide comentariile acelui pas exact. **Editează feedbackul** schimbă doar textul; **Șterge feedbackul** elimină o schiță. Fiecare înlocuire a planului invalidează ancorele anterioare, chiar dacă unele texte sunt identice. **Necesită reancorare** păstrează schițele lizibile: alege **Reancorează**, selectează un pas curent numerotat, alege explicit întregul text sau un fragment, apoi **Salvează reancorarea**. Schițele salvate rămân după închiderea sau schimbarea sesiunii.

**Revizuiește planul** trimite întregul plan curent și toate schițele valide într-o singură cerere în același chat. Agentul poate revizui planul structurat sau cere lămuriri, dar nu poate executa pași, modifica fișierele proiectului, rula programe sau comenzi ori acorda permisiuni în timpul revizuirii. Mesajele obișnuite sunt suspendate până la încheiere; **Oprește** încheie doar revizuirea, nu și programele independente din fundal. Modul de permisiuni doar pentru citire permite revizuirea planului; sesiunile arhivate și workbench-urile doar pentru citire permit numai consultarea.

**Revizuiri anterioare** păstrează comentariile trimise, contextul citat și rezultatele, inclusiv după golirea planului. Dacă trimiterea eșuează, schițele rămân disponibile. **Reîncearcă revizuirea** confirmă o trimitere cu răspuns necunoscut folosind cererea originală, fără a crea o a doua revizuire. După o revizuire acceptată dar eșuată, oprită sau limitată de context, **Restaurează feedbackul** pregătește schițele lipsă fără a suprascrie editările sau istoricul. Reîncercarea din chat face același lucru. Reancorează schițele învechite și alege din nou explicit **Revizuiește planul**; restaurarea nu trimite cereri automat. Limitele existente ale contextului conversației rămân valabile.

Schimbările de confidențialitate sau model actualizează afișarea. Editorul deschis păstrează feedbackul nesalvat, dar ascunde citatul capturat anterior; selectează explicit o țintă curentă înainte de a salva un comentariu nou sau o reancorare.

## Marcaje

Treci cu indicatorul peste un mesaj propriu sau folosește Tab pentru a ajunge la pictograma de marcaj. Alege **Marchează**; pictograma plină oferă **Elimină marcajul**. Previzualizarea de pe margine arată primul rând al mesajului și începutul răspunsului agentului, cu aceeași acțiune de marcaj. Modificarea apare imediat; dacă salvarea eșuează, starea anterioară revine și apare o eroare. În sesiunile arhivate și workbench-urile doar pentru citire poți doar consulta marcajele.

Marcajele de pe margine sunt pline, în culoarea principală și puțin mai lungi. Un grup este marcat dacă oricare mesaj din el are un marcaj. Folosește **Marcajul următor** (**Ctrl+Alt+N**) sau **Marcajul anterior** (**Ctrl+Alt+P**) pentru a sări între mesaje; navigarea se oprește la primul sau ultimul marcaj. Modifică tastele în **Setări → Comenzi rapide**.

Fila **Marcaje** din panoul din dreapta listează în ordine marcajele acestei conversații, fiecare cu începutul mesajului tău și al răspunsului. Activeaz-o din **Editează workbench-ul > Interfață > Filele panoului din dreapta**. Scrie în **Filtrează marcajele** ca să cauți în textul mesajului sau al răspunsului; numărul arată atunci potrivirile din total. Alege un rând sau apasă Enter ca să sari la mesaj în Chat; săgețile mută între rânduri. Bifează rânduri (sau **Selectează tot** pentru rândurile filtrate) și alege **Elimină selecția**, ori elimină un singur rând cu iconița de coș. **Șterge toate** elimină, după confirmare, toate marcajele conversației, indiferent de filtru. Eliminarea unui marcaj nu șterge niciodată mesajul; dacă eliminarea eșuează, nu se schimbă nimic și apare o eroare. Sesiunile arhivate și workbench-urile doar-citire permit doar filtrarea și saltul.

## Comenzi shell

Folosește opțiuni neinteractive: intrarea standard a agentului este închisă. Comenzile în prim-plan întorc codul de ieșire, ultimele 12.000 de caractere și jurnalul complet în `.vera/runs`. Cele în fundal întorc un identificator; agentul citește `program_output`, cu `until` pentru mesajul de disponibilitate, și le oprește cu `program_stop`. Continuă după încheierea apelului, dar se opresc cu sesiunea, aplicația sau modul Bypass care le-a pornit. Afișarea locală din Rulări respectă mascarea secretelor pentru rulări; jurnalele locale păstrează ieșirea originală. Procesul moștenește mediul utilizatorului fără cheile furnizorilor VERA sau valorile acreditărilor stocate. Comenzile sunt limitate la 4.096 de caractere.

Aprobările comenzilor și prefixele salvate sunt descrise în [Permisiuni](permissions.md); folderele din afara workbench-ului în [Workbench-uri](workbenches.md).

## Comenzi în Rulări

Deschide **Rulări** în panoul din dreapta pentru comanda exactă, folder, ieșire în timp real, cod de ieșire și durată. **Oprește** încheie întregul arbore de procese; agentul vede oprirea la următoarea citire a ieșirii. Pentru rulările încheiate, **Deschide jurnalul** deschide jurnalul păstrat în vizualizatorul text, inclusiv ieșirea dinaintea cozii afișate; dintr-un jurnal de peste 8 MiB se afișează ultimii 8 MiB. Sesiunea curentă este selectată implicit; alege **Toate sesiunile** pentru alte rulări. Programele pluginurilor își păstrează etichetele declarate. Mascarea rulărilor este implicit oprită. Când este activă, maschează secretele stocate din argumente, comenzi, foldere, erori, ieșire și starea programelor. Alegerea workbench-ului are prioritate față de setarea aplicației. Schimbările actualizează jurnalele deschise, inclusiv cele complete din vizualizator; jurnalele locale păstrează textul original.

## Terminalul utilizatorului

Deschide **Terminal** în panoul din dreapta sau apasă **Ctrl+Shift+T**. Shell-ul interactiv pornește în folderul workbench-ului, folosind Setări → Comenzi. Creează și închide file cu **Terminal nou** și **Închide terminalul**; redimensionează panoul pentru a rearanja ieșirea. Programele interactive acceptă tastarea. Oprirea sesiunii agentului lasă terminalele active; închiderea sau înlocuirea workbench-ului și ieșirea din VERA le închid. Suportul nativ este inclus.

Răspunsurile și blocurile de cod au acțiuni separate de copiere. Executarea este disponibilă pentru blocuri complete etichetate explicit PowerShell sau Bash, cu 1–16.384 de caractere și fără caractere de control ale terminalului. Comanda ajunge doar într-un shell curat nefolosit, al cărui prompt inițial gol este verificat înainte de execuție. Sunt oferite doar destinații eligibile; dacă nu există niciuna, Execută creează imediat un terminal curat. Dacă destinația primește intrare sau execută o comandă după selectare, VERA refuză injectarea și oferă **Execută într-un terminal nou curat**. Textul netrimis și programele interactive rămân neatinse. Terminalele curate omit profilurile shell; **Terminal nou** păstrează pornirea normală a shell-ului configurat. Opțiunea **Terminal nou curat (fără profil shell)** creează un shell compatibil separat. Anulare sau Escape readuce focalizarea pe Execută.

Fiecare terminal pornește privat. Pentru a permite agentului să citească unul, vezi [Permisiuni](permissions.md).

## Mascarea secretelor pentru agent și exporturi

Mascarea Agent și model se aplică rezultatelor instrumentelor trimise furnizorului, răspunsurilor transmise, căutării și afișării sesiunilor. Mascarea verifică textul căii fișierului. Pixelii imaginii sunt în afara domeniului ei. Artefacte și exporturi controlează separat conținutul și descrierile artefactelor salvate, exportul lor și exporturile JSON/Markdown ale sesiunilor. Ambele sunt implicit active; alegerea explicită a workbench-ului are prioritate față de setarea curentă a aplicației. Oprirea mascării Agent și model permite trimiterea către furnizor a secretelor stocate găsite în fișiere sau rezultate. Rulări și Afișare nu schimbă aceste reguli. Erorile furnizorului, testele conexiunii și jurnalele de diagnostic maschează mereu credențialele stocate. Citirea terminalului cere în continuare acordul pentru acel terminal. Textul deja salvat ca [REDACTED] nu poate fi recuperat prin oprirea mascării; citește din nou sursa originală sau recreează artefactul.
