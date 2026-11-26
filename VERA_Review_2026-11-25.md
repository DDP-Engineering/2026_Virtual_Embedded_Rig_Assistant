# Review al implementării VERA (fără plugin-uri)

Data: 2026-11-25 · Commit analizat: `1939ab67` (master) · Versiune: 0.3.0

## 1. Concluzie

Fundația este solidă: granițele dintre module se respectă, jurnalul de evenimente al sesiunilor
supraviețuiește opririi și repornirii, scrierile în fișiere sunt protejate corect, iar lint-ul și
typecheck-ul trec curat. Problemele nu sunt de arhitectură. Sunt în **drumul de bază al
utilizatorului**, unde câteva defecte mici opresc sau strică fluxul:

1. **Prima utilizare se poate termina cu „The request is invalid.”** După adăugarea unei chei API
   sau a unui server local nu se setează niciun model implicit, iar aplicația nu spune ce lipsește.
2. **Erorile de provider încheie tura fără cale de reluare.** Nu există reîncercare automată, iar
   butonul Retry nu poate apărea în aplicația reală.
3. **Uneltele agentului dau rezultate goale sau greșite fără semnal**: `grep` pe un fișier întoarce
   zero rezultate, `edit` strică fișierele care nu sunt UTF-8, PowerShell 5.1 raportează eșec la
   comenzi reușite.
4. **Documentele, funcția centrală a produsului, au trei defecte vizibile**: textul extras din PDF
   rupe indicii și exponenții (V_DD, I²C), un PDF neindexat se deschide ca hex dump, iar Reindex
   șterge tot indexul.
5. **Există multe gărzi care întrerup un flux normal** (secțiunea 6). Cele mai multe se pot relaxa
   fără pierderi.

Raportul conține 62 de constatări. Secțiunea 4 are cele 16 care merită reparate întâi; secțiunea 8
propune ordinea de lucru.

## 1a. Starea corecțiilor (actualizat 2026-11-25)

Constatările sunt marcate în text cu **[CORECTAT]** sau **[PARȚIAL]**. Restul sunt nelucrate.
Corecțiile au trecut lint-ul, typecheck-ul și teste țintite; **nu au fost verificate în aplicația
Electron reală și suita completă de teste nu a fost rulată.**

| Unde | Constatări |
|---|---|
| Commit `6f2400fa` | F-01, F-03, F-04, F-05, F-06, F-07, F-09, F-10, F-11, F-12, F-13, F-14, F-15, F-16, F-18 |
| Necomis (lotul 5) | F-21, F-32, F-35, F-53, F-58 și patru gărzi din secțiunea 6: linkuri externe, focus pe Stop, redenumire în timpul turei, schimbarea modelului de embedding |
| Necomis (lotul 6) | F-34, F-36, F-40, F-45, F-47, F-54, F-60 |
| Necomis (lotul 7) | F-22, F-24, F-33, F-41, F-57 |
| Necomis (lotul 8) | F-01 (restul), F-27, F-28, F-29, F-52 |
| Necomis (lotul 9) | F-25, F-26, F-51 |
| Necomis (lotul 10) | F-19, F-38 |

Ce lipsește la cele marcate **[PARȚIAL]**:

- **F-01:** butonul către Providers și indicația de pe ecranul gol există din lotul 8. A rămas un
  singur caz: o cheie OpenAI salvată fără model tot nu setează un model implicit.
- **F-04:** fără reîncercare automată; Retry adaugă un mesaj duplicat al utilizatorului.
- **F-07:** o cheie identică cu identificatorul providerului (cazul `lm-studio`) blochează în
  continuare salvarea și alegerea modelului.
- **F-15:** doar clicul pe indicatorul de progres este oprit. Reindex cu indexarea oprită și
  schimbarea fragmentării șterg în continuare tot indexul.
- **F-53:** doar textul întrebării este corectat; dialogul este tot nativ, iar bifarea „Show advanced
  settings” tot marchează pagina ca modificată.
- **F-34:** un octet NUL rătăcit nu mai face un log „binar” (pragul este acum 1 % din primii 8 KiB).
  `parse_log` tot refuză un octet UTF-8 invalid, iar UTF-16 tot contează ca binar.
- **F-60:** un apel IPC eșuat scrie acum în log tipul erorii și locul din cod, fără mesaj (un test
  existent interzice mesajul, care poate cita o valoare). Lipsesc handlerele pentru
  `uncaughtException` și acțiunea „deschide dosarul de loguri”.
- **F-24:** un mesaj trimis readuce vederea la sfârșit. Lipsește butonul „la ultimul mesaj” pentru
  cititorul care a derulat în sus fără să trimită nimic.
- **F-33:** `read` și `read_doc` nu se mai trimit unul la altul; mesajele spun ce trebuie făcut.
  Un PDF neindexat tot nu poate fi citit de agent, iar descărcările rămân în `.vera/downloads`.
- **F-41:** paginile se desenează la densitatea de pixeli a ecranului, zoomul merge până la 400 %,
  iar o pagină prea mare se desenează mai puțin clar în loc să rămână goală. Nu am verificat pe ecran.
- **F-29:** `session_wait` acceptă acum până la 10 minute. Cât timp copilul așteaptă o aprobare,
  așteptarea tot se întoarce imediat, iar Stop pe părinte tot lasă copiii să ruleze.
- **F-51:** un fragment prea mic, o suprapunere mai mare decât fragmentul, zero rezultate sau un model
  scris greșit țin acum Save dezactivat. Câmpul de model este tot text liber, iar Save dezactivat nu
  spune care câmp este greșit.
- **F-19:** rezumatul de compactare este acceptat și când modelul pune text în jurul obiectului JSON,
  omite o listă sau pune obiecte în ea. Un rezumat care tot eșuează este în continuare reîncercat la
  fiecare apel de model.
- **F-31 / F-32:** regulile de prefix sunt lărgite (F-32); „Always allow” tot nu are efect în Ask
  (F-31), fiindcă documentația definește prefixele doar pentru Auto-edit.

Încercat și retras: **F-02** (factorul de 0,4 tokeni per octet rupe 33 de teste de compactare).
Neatinse din cele 16 prioritare: **F-02** și **F-08**.

De făcut manual după F-13: pe un workbench deja indexat, șterge `.vera/cache/extract` și reindexează.

Pe parcurs am reparat și un test care pica deja pe master
(`workbench-activity.test.ts`, rămas pe vechea limită de 3 ture simultane).

## 1b. Audit de integrare — 2026-11-26

Baza verificată este `6617fd4b`, sincronizată din `origin/master` prin fast-forward.
Loturile marcate „Necomis” în secțiunea anterioară sunt istorice. Corecțiile lor sunt în
`1796caec` și `6617fd4b`, după primul lot din `6f2400fa`.
Domeniul auditului și al remedierilor este F-01–F-62. „Local” indică modificări în candidatul
de după această bază. Probele Windows, Ubuntu WSL2 și LM Studio sunt raportate separat.

| Finding | Decizie și stare |
| --- | --- |
| F-01 | Corecția publicată este necesară. Un model indicat la salvare devine implicit, iar lipsa lui trimite utilizatorul la Providers. Cheia OpenAI singură nu identifică un model disponibil pentru acel cont. Selecția rămâne explicită. |
| F-02 | Limitarea la rece se reproduce și este definită explicit în REQ-NFR-4721c12f, inclusiv după schimbarea modelului într-o sesiune cu istoric. Raportul nu justifică o estimare globală de 0,4 tokeni/octet. Păstrat contractul până la o revizuire măsurată a preflight-ului. |
| F-03 | Corecția publicată este necesară și afișează fișierul și problemele de schemă. Local, dialogul folosește numele aplicației și evită expunerea mesajului brut al unei excepții necunoscute. |
| F-04 | Retry manual este necesar pentru erorile tranzitorii. Local, autentificarea și configurarea nu mai sunt tratate ca tranzitorii. Retry explicit retrimite ultimul mesaj căruia i se aplică eroarea și rămâne vizibil în istoric. Reîncercarea automată ar schimba politica de execuție. |
| F-05 | Publicat. Textul din compozitor răspunde întrebării pendinte, iar Enter trimite din card. Mesajele cu imagini și răspunsurile mai mari decât limita cardului trec prin trimiterea obișnuită. |
| F-06 | Publicat. Local, confirmarea trimiterii golește aceeași versiune de ciornă și după revenirea în sesiune. O ciornă editată între timp este păstrată. |
| F-07 | Parțial publicat. Mesajele, titlurile și citirea setărilor sunt deblocate. REQ-SEC-fe4d5c4c păstrează validarea identificatorului derivat față de secretele cunoscute. Dacă un nume intră în coliziune cu o cheie, se poate folosi un alt nume sau o altă cheie. |
| F-08 | Local. Căutarea binară folosește o singură măsurare a cererii complete per probă, inclusiv pentru istoricul cu multe rezultate de unelte. Păstrează detaliile care încap, iar un rezultat prea mare poate fi reprezentat prin referințele sale. |
| F-09 | Publicat. O cale de fișier funcționează în grep, iar omisiunile cunoscute sunt numărate. Recursivitatea tiparului fără separator este o alegere de contract introdusă explicit, separată de remedierea rezultatelor goale. |
| F-10 | Publicat. Local, read validează întregul flux înainte să aleagă UTF-8. Dacă întâlnește octeți invalizi și fișierul este text, read și grep folosesc aceeași reprezentare Latin-1 ca edit, inclusiv după primii 64 KiB. |
| F-11 | Publicat. Local, prima pregătire a sesiunii așteaptă rezolvarea shell-ului înainte de prompt. |
| F-12 | Corecția publicată era necesară. Excepția comună admitea și pregătirea scrierii din instrumentele obișnuite. Local, read, grep, parse_log și citările se limitează la loguri admise pentru citire. Scrierile obișnuite, redirecționările și celelalte fișiere de runtime sunt refuzate. |
| F-13 | Publicat pentru indicii și fracțiunile de linie. Rezultatul depinde în continuare de ordinea și geometria elementelor emise de PDF.js. Pentru extracțiile anterioare se aplică procedura de cache din secțiunea precedentă. |
| F-14 | Publicat pentru PDF-uri ordinare, permise și limitate ca dimensiune. Afișarea și indexarea sunt independente în acest caz. |
| F-15 | Local. Overview oferă Retry pentru documentele eșuate fără a reface documentele sănătoase. Reconcile după schimbarea fragmentării păstrează rândurile existente. Reindex rămâne acțiunea explicită pentru refacerea întregului index. |
| F-16 | Publicat. Numai o pagină ori un subinterval inclus în intervalul emis pentru același document poate fi validat prin această regulă. |
| F-17 | Cazul se aplică, dar coada durabilă protejează intenția utilizatorului după Stop. Nu se declanșează automat o tură nouă în urma unei opriri explicite. |
| F-18 | Publicat. Limita de output are eveniment, mesaj și acțiunea Continue. |
| F-19 | Parserul tolerant este publicat. Local, o încercare automată nereușită dezactivează repetarea pe pașii următori ai turei. Un rezumat valid dintr-un pas anterior rămâne utilizabil. |
| F-20 | Local. Compozitorul rămâne editabil cât așteaptă confirmarea trimiterii sau o aprobare. Trimiterea respectă blocarea deja impusă de tură și de aprobare. |
| F-21 | Publicat. Compozitorul respectă starea arhivată. |
| F-22 | Căutarea este publicată. Local, sesiunile de nivel superior sunt paginate, cu copiii păstrați sub părintele lor. |
| F-23 | Local. Grupul în desfășurare afișează numele uneltei active, iar detaliile păstrează argumentele și ținta. |
| F-24 | Reactivarea urmăririi la trimitere este publicată. Local, cititorul poate reveni la ultimul mesaj cu un buton. |
| F-25 | Navigarea este publicată. Local, primul Shift+Enter pleacă de la ultima potrivire, inclusiv la două rezultate. |
| F-26 | Publicat. Eroarea de context oferă Compact now pentru ultima eroare a unei sesiuni editabile și inactive. |
| F-27 | Publicat. Mesajul de autentificare din transcript folosește același buton către Providers ca eroarea din setări. |
| F-28 | Publicat. O referință de model eliminată are un mesaj dedicat. |
| F-29 | Publicat pragul de zece minute. O aprobare pendinte este un rezultat acționabil al așteptării. Propagarea lui Stop ar schimba controlul separat al copiilor. |
| F-30 | Local. Raționamentul live apare lângă mesajul căruia îi aparține, iar bufferul live al unei operații se eliberează la finalizarea ei. |
| F-31 | Local. Ask continuă să ceară aprobarea fiecărei comenzi, iar controlul care salvează prefixul apare numai în Auto-edit. |
| F-32 | Publicat pentru formele de build uzuale. Local, relaxarea opțiunilor scurte este limitată la formele de build confirmate; regula conservatoare rămâne pentru celelalte unelte. |
| F-33 | Ghidarea corectă este publicată. Citirea la cerere a PDF-urilor excluse din index și accesul agentului la descărcări ar adăuga o sursă separată, cu buget și proveniență. Nu sunt acoperite de remedierea mesajului. |
| F-34 | Pragul pentru octeți NUL răzleți este publicat. Local, read și grep recunosc UTF-16 cu BOM. parse_log păstrează validarea strictă UTF-8 pentru analiza structurată și indică formatul cerut. |
| F-35 | Corecția pentru căi absolute din workbench și nume POSIX este necesară. Local, citările acceptă aceste nume, iar garda refuză în continuare căile de drive din afara workbench-ului. Pregătirea comenzilor pluginurilor păstrează regulile portabile pentru nume rezervate, conform REQ-SEC-aaeae5cb. |
| F-36 | Publicat. Descrierile parametrilor și eroarea de înlocuire indică textul exact, fără prefixele de numerotare. |
| F-37 | Regula se aplică și este intenționată: secretele din variabile nu sunt moștenite de procesele agentului. Invocarea prin terminalul utilizatorului are altă autoritate. |
| F-38 | Publicat. Navigarea la pagină este transmisă vizualizatorului PDF, iar Find pornește de la pagina vizibilă. |
| F-39 | Recitirea este confirmată. Pentru citări diferite rămâne necesară reverificarea sursei și a locatorului. O optimizare cere reutilizare legată de revizia verificată și măsurători pe fișiere mari. |
| F-40 | Publicat. Clasificarea pornește de la conținut și permite loguri text cu secvențe ANSI. |
| F-41 | Schimbările sunt publicate în canvas. Verificarea vizuală la scalări și rezoluții reale rămâne distinctă de testele de unitate. |
| F-42 | Local. Next și Previous reutilizează până la 10.000 de potriviri ale căutării curente într-un fișier obișnuit, după reverificarea reviziei. Un fișier aflat în creștere poate cere Retry. Citările păstrează verificarea strictă pe octeți. |
| F-43 | Local. Evenimentele de configurare care nu schimbă mascarea Display păstrează documentele deja deschise. |
| F-44 | Retenția și remontarea sunt confirmate. Politica de cache și efectul la scară rămân de măsurat cu ferestre și PDF-uri reprezentative. |
| F-45 | Publicat pentru fragmente scrise cu majuscule și lungime de cel puțin trei caractere. |
| F-46 | Reindexarea după mutare se poate aplica. Optimizarea vectorilor necesită separarea identității conținutului de locator și de modelul de embedding. Cache-ul de extracție rămâne disponibil. |
| F-47 | Publicat. Numărul de fire este limitat la patru. Măsurarea istorică a vitezei depinde de host și de model. |
| F-48 | Local. Indexarea și vizualizarea fișierelor text recunosc BOM UTF-16 și folosesc Windows-1252 după UTF-8 invalid. Citările verifică în continuare revizia sursei, inclusiv pozițiile liniei la afișarea pe ferestre. |
| F-49 | Local, arborele și căutarea se actualizează la revenirea focusului. Virtualizarea și costul la scară necesită măsurare separată. |
| F-50 | Local. Proprietatea este legată de garda IPC nativă pe toată durata workbench-ului. Un fișier rămas cu PID reutilizat poate fi preluat, iar un proprietar activ păstrează exclusivitatea. O deschidere eșuată la oprirea indexării eliberează garda nouă. |
| F-51 | Publicat pentru validarea formularului înainte de Save. Un selector cu catalog și atribuirea erorii pe fiecare câmp sunt îmbunătățiri UX distincte de defectul inițial de salvare. |
| F-52 | Publicat. Crearea unui workbench deschide o sesiune și cere focusul compozitorului pentru sesiunea nouă. |
| F-53 | Publicată distincția din textul întrebării. Confirmarea nativă și salvarea explicită a comutatorului urmează modelul existent al paginii Advanced. |
| F-54 | Publicat. Grupul precizează că comutatoarele controlează mascarea secretelor. |
| F-55 | Local. O cheie salvată permite testul explicit când selecția implicită este goală. Un model activat este utilizat când există. |
| F-56 | Discover este disponibil pentru presetările cu catalog. Descoperirea generică înainte de salvare pentru Ollama și alte endpoint-uri este o funcție suplimentară. Selectarea manuală permite utilizarea lor. |
| F-57 | Publicat. Dialogul ChatGPT are Cancel. |
| F-58 | Publicat. Rezumatul afișează numele corect al modului Bypass. |
| F-59 | Presetările propuse sunt integrări noi. Lipsa lor nu defectează providerii existenți. Suportul trebuie verificat separat pentru fiecare protocol, catalog și tip de autentificare. |
| F-60 | Publicat tipul și locul erorilor IPC fără valoarea brută. Local, dialogul de startup folosește detalii structurate și mascate. Capturarea globală a excepțiilor sau o comandă de deschidere a folderului sunt acțiuni separate. |
| F-61 | Comportamentul se aplică și este documentat: terminalele interactive aparțin workbench-ului afișat. Păstrarea lor în fundal ar schimba proprietarul și durata resurselor interactive. |
| F-62 | Local. Introducerea de text programează verificarea imediată a ecoului fără poll-uri IPC concurente. Snapshot-ul complet păstrează comportamentul de mascare și de reconectare. |

### Verificarea candidatului din 26 noiembrie

Testele țintite pe baza publicată au avut 350 de rezultate reușite și 2 omise. Am comparat
corecțiile cu cerințele active și am integrat remedierile locale consemnate mai sus. Ultima
rundă a ambelor review-uri AEGIS a aprobat candidatul. Verificarea AEGIS strictă a raportat
zero erori și avertismente de trasabilitate, documentație și fișiere locale preexistente.

| Probă | Rezultat observat |
| --- | --- |
| Windows, prima rulare `verify:all` | Verificările statice au trecut. Suita aplicației a avut 4.197 trecute, 106 eșuate și 41 omise. |
| Ubuntu WSL2, prima rulare `verify:all` | Verificările statice au trecut. Suita aplicației a avut 4.148 trecute, 155 eșuate și 41 omise. |
| Regresii Windows după corecțiile găsite la verificare | 169 trecute și 8 omise în 13 fișiere. Retestarea legării argumentelor pluginurilor a avut 26 trecute și 1 omisă. Proba CLI de indexare și căutare cu un proprietar real al gărzii IPC a trecut. |
| Regresii Linux în WSL2 după corecții | 152 trecute în rularea țintită, cu o aserțiune de fixture corectată ulterior. Retestarea selecției documentelor, inclusiv numele POSIX, a avut 9 trecute și 1 omisă. Verificările intermediare pentru compactare, citire, citări și workbench au avut 104 trecute. Proba CLI cu garda reală a trecut la reluarea izolată. |
| Qwen 3.8 27B prin LM Studio, `local-32k` | Candidatul final a trecut în 38,1 s. A păstrat toate deciziile și sarcinile din fixture, fără valori inventate sau executarea instrucțiunii din date. Raportul dintre contextul estimat după și înainte de compactare a fost 0,7195. |
| Windows Npcap și Dumpcap 4.6.10 | Proba țintită a avut 3 teste trecute. Captura scurtă a înregistrat 25 de pachete UDP sintetice. Captura rotativă a păstrat 2 segmente cu 13 și 4 pachete și a rotit 3 segmente, iar TShark a citit segmentele păstrate. Fixture-ul trimite pachete pe durata capturii reale și înainte de pornirea ei. |
| Browser Windows, rularea completă | 37 trecute, 21 eșuate. Testele de aprobare care așteptau vechea stare a compozitorului au fost actualizate pentru comportamentul F-20. |
| Browser Ubuntu WSL2, rularea completă reluată | 45 trecute, 13 eșuate. Au trecut scenariile F-20 din browser pentru aprobări și compozitor editabil. |
| Electron Windows, rularea completă | 106 trecute, 24 eșuate și 7 omise. Au trecut, între altele, navigarea într-un log de 200 MiB, actualizarea mascării și testul PTY. După ajustarea fixture-urilor, toate cele cinci cazuri native de aprobare, cele două cazuri browser ajustate și deschiderea unui workbench în mod de citire cu o gardă reală au trecut. |
| Electron Ubuntu WSL2, rularea completă | 107 trecute, 23 eșuate și 7 omise. Au trecut citările verificate din fișiere mari, navigarea într-un log de 200 MiB și menținerea răspunsului IPC la `parse_log` și `grep`. La reluările țintite au trecut toate cele cinci aprobări native și accesul în mod de citire cu gardă reală. |
| Pluginurile oficiale pe Windows | 686 trecute, 7 eșuate și 183 omise. Eșecurile sunt în suitele Wireshark TShark, MicroPython și Power Profiler. |
| Pluginurile oficiale în Ubuntu WSL2 | 685 trecute, 7 eșuate și 185 omise. Eșecurile sunt în suitele Wireshark TShark, Power Profiler și Raspberry Pi Linux. |
| Browser F-24, reluări țintite | A trecut pe ambele platforme. Tastarea păstrează poziția de citire, iar trimiterea revine la ultimul mesaj. |

Tabelul păstrează rezultatul fiecărei rulări integrale și îl indică separat pe cel al reluărilor
țintite. Linux a fost testat în Ubuntu WSL2. După întreruperea primei încercări browser din WSL2,
rularea a fost reluată cu un worker. Testele Electron și browser au fost executate separat, astfel
încât eșecul unei ramuri să permită executarea celeilalte.

Rulările complete au evidențiat și timeout-uri de integrare. Cele trei cazuri CLI pentru
`parse_log` și Bypass au fost reluate pe candidatul local și pe sursa exactă `6617fd4b`. În ambele
versiuni, cererea din tura curentă a depășit bugetul de intrare de 27.033 de tokenuri al
providerului Replay la rece. Au rămas utile ca dovadă pentru F-02. O schimbare a estimării la
rece ar afecta toate modelele și cere o măsurare separată. Limita este înregistrată explicit
în rezultatul de verificare. Am reprodus separat și cele două eșecuri ale evaluatorului Replay
pe `6617fd4b`. În `local-32k`, ultima tură n-a fost finalizată. `long-history` s-a oprit la al
cincilea tur de pregătire a istoricului, înaintea interogării modelului din scenariu.

Logurile complete și probele Npcap sunt în `05_Software/test-outputs/vera-review-6617/`.
Rezultatul brut al probei LM Studio este în
`05_Software/evaluation-outputs/compaction/20261126-003612-qwen-qwen3.8-27b-low/run.json`.

Verificarea completă rămâne cu eșecuri pe ambele platforme. Corecțiile locale sunt în
working tree pe `master`, cu baza `6617fd4b`.

### Retestarea regresiilor pentru VERA 0.4.0

Am comparat eșecurile cu `6617fd4b` și cu schimbările intenționate din istoricul ramurii.
Pe baza curată, șase din zece probe browser selectate au reprodus eșecurile anterioare. Proba
catalogului a eșuat pentru că lista așteptată omitea Dumpcap. Cazurile Power Profiler și
Raspberry Pi Linux au trecut în reluarea izolată pe aceeași bază.

| Probă | Ce s-a schimbat |
| --- | --- |
| Crearea unui workbench și scenariile de chat sau Plan | Fixture-ul încarcă sesiunile de probă la listare sau înaintea unei cereri care poate reutiliza o sesiune goală. Prima ajustare încărca exemplele și pentru crearea explicită din teste. Rularea completă a arătat că aceasta altera listele de test, iar condiția a fost restrânsă la cererile cu reutilizare. Testele care folosesc editorul deschid explicit prezentarea generală după ce verifică sesiunea inițială. |
| F-20 și compozitorul în stări speciale | Am corectat o regresie din implementare. Draftul și trimiterea sunt blocate în revizuirea Plan și în timpul reîncărcării proiecției mascate. Tura activă rămâne disponibilă pentru **Oprește**. Testul atașamentelor confirmă că, în timpul unei aprobări obișnuite, draftul poate fi modificat și trimiterea rămâne oprită. |
| Setări, permisiuni și notificări | Aserțiunile folosesc limitele publicate de 200 de apeluri și patru ture. Navigarea cu tastatura verifică și secțiunea de permisiuni. Testul Bypass verifică alinierea controalelor actuale și afișarea deciziei automate pentru operația ireversibilă simulată. |
| Căutare și file de documente | Testul de căutare verifică rezultatele din bara laterală, inclusiv lipsa unei potriviri. Testul de citări verifică ștergerea înregistrării de file cu identitatea completă a workbench-ului, folderului și sesiunii. |
| Probe Electron pentru viewer, linkuri și Bypass | Viewerul folosește un PDF valid exclus din index și verifică deschiderea în pagini, precum și opțiunea de citire a textului cu octeți invalizi. Testul linkurilor verifică deschiderea directă și dialogul când browserul refuză. Probele Bypass folosesc o sesiune nouă după schimbarea valorii implicite și deschid detaliile deciziei pentru a verifica directoarele folosite. |
| Schimbarea modelului de embedding | Testul păstrează refuzul când lipsește confirmarea sau modelul de plecare e greșit. Adaugă un document în timpul confirmării și verifică acceptarea schimbării și reconstruirea indexului. |
| Opțiunile de model din editorul workbench-ului | Proba configurează modelul de test înainte ca sesiunea inițială să citească lista furnizorilor. Verifică în continuare sugestia din editor, metadatele și accesul la unealta pentru imagini. A trecut la retestare pe ambele platforme. |
| Catalogul oficial și Wireshark | Testul de împachetare include Dumpcap. Proba de descoperire verifică starea TShark alături de utilitarele adăugate. Comparația verifică aceleași numere în tabelul UDP și numără marcajele ACK raportate de versiunea nativă. TShark 4.6.10 marchează cadrul 8 din fixture, iar 4.2.2 nu îl marchează. |

Retestarea browser pe Windows a trecut în 11 cazuri din 12 înainte de ajustarea finală a
scenariului Bypass. Proba de împachetare a trecut în WSL2 după includerea Dumpcap. Cele trei
limite CLI și cele două eșecuri Replay reproduse anterior pe baza curată rămân în evidență.
După actualizarea comparației ACK, cele două probe TShark țintite au trecut în WSL2 cu
TShark nativ 4.2.2, fără omisiuni între probele selectate.

Help-ul din aplicație a fost actualizat în engleză, română, germană și franceză. Verificarea
automată a confirmat prezența celor 13 pagini per limbă și a ajutorului pentru cele 44 de pluginuri
oficiale, cu legături valide. Corecțiile și capabilitățile noi sunt în CHANGELOG și în notele
VERA 0.4.0. Verificarea completă folosește această versiune pe ambele platforme.

| Suită completă VERA 0.4.0 | Windows | Ubuntu WSL2 |
| --- | --- | --- |
| Aplicație, după verificările statice | 4.237 trecute, 66 eșuate, 44 omise | 4.201 trecute, 94 eșuate, 52 omise |
| Pluginuri oficiale | 691 trecute, 2 eșuate, 184 omise | 686 trecute, 5 eșuate, 186 omise |
| Browser | 57 trecute, 1 eșuat | 58 trecute |
| Electron și restul scenariilor seriale | 120 trecute, 10 eșuate, 7 omise | 118 trecute, 12 eșuate, 7 omise |

Numerele de mai sus sunt rezultatele brute ale rulărilor complete. Ele includ eșecurile
care au declanșat corecțiile ulterioare ale fixture-ului browser și ale compozitorului.
Pentru retestarea celor șapte fișiere de renderer, toate cele 101 cazuri au trecut pe
fiecare platformă, cu limita de 20 s aplicată din linia de comandă. Limitele din depozit
au rămas aceleași. În WSL2 au mai trecut 98 de cazuri din Plan, navigarea în transcript,
lista pluginurilor și serviciul de workbench. Pe Windows au mai trecut 50 de cazuri din
Plan, setările avansate, selectorul de permisiuni, Git și navigarea în transcript.
Proba browser pentru foldere suplimentare în patru limbi a trecut când a fost reluată pe
Windows. Ambele cazuri Windows rămase în suita de pluginuri au trecut la retestarea
țintită cu aceleași aserțiuni și limite.

În Electron, retestarea Windows a confirmat acordarea folderelor suplimentare, Bypass și
prefixele de comandă. Proba logului de 200 MiB a trecut la reluarea nativă în WSL2. Primul
document a rămas în starea `pending` după cele 5 s ale probei de indexare la rece,
atât în rulările complete, cât și în reluările de pe ambele platforme.

Pe Windows, suita de pluginuri a confirmat din nou captura Npcap prin Dumpcap. Captura scurtă a
înregistrat 24 de pachete sintetice. Rularea rotativă a păstrat două segmente PCAPNG verificate,
cu 2 și 0 pachete. Starea TShark și comparația traficului au trecut la reluarea țintită pe
ambele platforme.

Pe baza curată `6617fd4b`, probele WSL2 de profilare media și comparație de capturi au depășit
aceleași limite de 45 s și 60 s. Proba MQTT a reprodus exact ieșirea care începe cu mesajul
`Client is` înaintea JSON-ului. Cazul Raspberry Pi Linux a eșuat la verificarea procesului
în rularea completă și ulterior la pornirea lui în proba izolată. Eșecul la pornire s-a repetat
pe baza curată.

Verificările statice au trecut pe Windows și WSL2. Rezultatele integrale rămân cu eșecuri.
Sunt consemnate separat limitele de context reproduse pe bază, cazurile corectate și
retestate, precum și eșecurile de timp sau de UI fără o regresie nouă confirmată.
Versiunea `0.4.0` și modificările rămân locale pe `master`.

Logurile sunt în `05_Software/test-outputs/vera-review-regressions/`.

## 2. Domeniu și metodă

**Analizat:** `05_Software/src` fără teste, circa 70.000 de linii: bucla agentului, sesiunile și
stratul de modele; uneltele încorporate și aprobările; workbench, indexare, căutare și stocare;
procesul main și granița IPC; interfața (chat, setări, provideri, workbench, vizualizatoare de
documente, Git); CLI; arhitectura și starea testelor.

**Exclus, conform cererii:** `05_Software/plugins`, motorul de plugin-uri (`core/src/plugins`, cu
excepția `shell.ts` și `command-tools.ts`, care implementează `run_command`) și ecranele de
plugin-uri. Modulele de domeniu din core (`electrical`, `wireshark`) au fost privite doar ca
legătură cu restul codului, nu în interior. `02_Tools` (livrare, împachetare) nu a fost analizat.

**Cum am lucrat:**

- Opt treceri de review independente, câte una pe subsistem, prin citirea codului.
- Am parcurs interfața ca utilizator, cu rendererul pornit pe API-ul simulat (`VITE_API=mock`):
  workbench nou, sesiune, mesaj, erori, setări. **Nu am rulat aplicația Electron reală**, nu am
  apelat niciun model și nu am testat pe hardware sau pe Linux.
- `biome check`: 0 erori, 6 avertismente. `tsc -b`: trece. `check:i18n` și `check:help`: trec.
  Suita de teste nu a fost rulată.

**Cât de sigură este fiecare constatare:**

| Marcaj | Înseamnă |
|---|---|
| **[V]** | Am verificat eu direct, în cod sau în interfață. |
| **[R]** | Un revizor a reprodus sau a măsurat prin rulare (script separat, pe date sintetice). |
| **[C]** | Un revizor a constatat prin citirea codului; nu am verificat a doua oară. |

**Prescurtări de cale** (toate sub `05_Software/src/`): `core/` = `libraries/core/src/`,
`shared/` = `libraries/shared/src/`, `main/` = `apps/desktop/src/main/`,
`renderer/` = `apps/desktop/src/renderer/`, `cli/` = `apps/cli/src/`.

## 3. Ce funcționează bine

- **Granițele dintre module se respectă.** `@vera/shared` importă doar `zod`; `@vera/core` nu
  importă Electron sau React; rendererul atinge `window.vera` doar în `renderer/api/ipc.ts`.
  Regula este impusă în `biome.json` și în `tests/tooling/boundaries.test.ts`.
- **Sesiunile sunt durabile.** Un singur reducer servește și reconstrucția, și actualizarea live
  (`shared/session-state.ts`); `recover()` închide o tură întreruptă de o cădere; un reload al
  rendererului reia fluxul din evenimentele stocate (`core/sessions/hub.ts:135-175`).
- **Stop funcționează peste tot**: flux de la model, unelte, aprobări, apel de rezumare. Textul deja
  primit se păstrează.
- **Scrierile în fișiere sunt corecte.** Amprentă la citire, reverificare în coada de scriere,
  fișier temporar plus redenumire, CRLF și BOM păstrate (`core/tools/changes.ts`).
- **Indexarea converge.** Fiecare document se publică într-o tranzacție; doar procesul main atinge
  SQLite; căderile indexerului sunt numărate și oprite după trei în 60 s.
- **Vizualizatoarele pentru fișiere mari sunt mărginite**: citiri pe ferestre, LRU de 4 ferestre,
  anulare per operație. Nu există curse între tab-uri.
- **Rendererul tratează bine fluxul de text**: delta-urile sunt grupate o dată pe cadru, iar
  evenimentele sesiunii A nu pot ajunge în sesiunea B (`renderer/hooks/use-session-events.ts`).
- **Setările avansate sunt bine făcute**: 49 de valori, toate cu limite, valoare moștenită afișată,
  Reset pe câmp, filtru „doar valorile modificate”.
- **Uneltele de domeniu nu costă pe cine nu le folosește.** Fără plugin-urile respective, o sesiune
  trimite modelului 24.444 de caractere de specificații de unelte din 68.697.
- **Cele patru limbi au exact aceleași chei** (1.728 fiecare).

## 4. De reparat întâi

Fiecare punct are: ce pățește utilizatorul, unde este în cod, cea mai mică reparație.

### Prima utilizare

**F-01. [PARȚIAL] După adăugarea unui provider cu cheie sau local, primul mesaj eșuează cu „The request is
invalid.” [V]**
Salvarea unui provider nu setează `defaultModel` când acesta este gol
(`main/provider-settings.ts:248-262`); doar autentificarea ChatGPT o face
(`main/chatgpt-auth.ts:172-177`). Compozitorul rămâne pe „Default model”, iar
`resolveModelReference` aruncă `INVALID` (`core/llm/gateway.ts:15-16`). La fel se întâmplă când nu
există niciun provider. Ecranul de pornire arată doar sigla VERA, fără nicio indicație.
*Reparație:* la salvarea unui provider, dacă `defaultModel` este gol, pune modelul salvat. Înlocuiește
mesajul generic cu „Niciun model ales” plus un buton către Settings → Providers. Pe ecranul gol,
când nu există provider, arată o singură linie cu același buton.

**F-02. Un model personalizat cu fereastra implicită de 32k poate refuza primul mesaj. [V] numărare,
[R] mărimi**
Până la prima calibrare, tokenii se estimează la 1 token per octet de JSON
(`core/agent/context.ts:32-54`). Revizorul a măsurat cererea goală (30 de unelte, `WORKBENCH.md`
gol) la 24.680 față de un buget de 27.033. Un `WORKBENCH.md` de peste circa 2,5 KB dă „The input
exceeds the model context budget” înainte de orice apel, deci calibrarea nu mai are loc. La
schimbarea modelului în mijlocul sesiunii, calibrarea salvată nu se aplică istoricului, care este
supraestimat de câteva ori.
*Reparație:* fără calibrare, estimează la circa 0,4 tokeni per octet; folosește calibrarea de la
nivelul aplicației ori de câte ori sesiunea nu are una pentru modelul curent.

**F-03. [CORECTAT] Un `settings.json` invalid oprește aplicația fără fereastră și fără mesaj. [V]**
`core/settings/service.ts:60-68` aruncă `INVALID` fără detalii; `main/index.ts:2422-2430` scrie în
log doar `app.startup.failed` și iese cu codul 1. Fiecare pornire ulterioară face la fel.
*Reparație:* scrie în log căile din eroarea zod și arată `dialog.showErrorBox` cu numele fișierului
și al cheilor.

### Conversația

**F-04. [PARȚIAL] O eroare trecătoare de provider încheie tura, iar Retry nu există în aplicația reală. [V]**
Toate locurile care emit un eveniment de eroare pun `retryable: false`
(`core/agent/runtime.ts:42, 209, 431, 526, 537`; `core/sessions/service.ts:2326`). Butonul Retry
cere `item.retryable` (`renderer/components/session/transcript.tsx:331`), deci apare doar în
fixture-ul de mock (`renderer/mocks/session-fixtures.ts:76`). La un 429, un 5xx sau o conexiune
căzută, utilizatorul trebuie să observe și să scrie „continuă”.
*Reparație:* marchează `retryable: true` pentru limită de rată, 5xx, rețea și timeout. Opțional,
când fluxul cade înainte de orice text, reîncearcă de 2-3 ori cu pauză, întreruptibil cu Stop.
`Agent.md` spune azi „fără reîncercări”, deci a doua parte este o decizie de produs.
*Atenție la activare:* Retry retrimite ultimul mesaj al utilizatorului, nu pe cel care a eșuat
(`renderer/components/session/workspace.tsx:227-233`), și adaugă un mesaj duplicat. Permite Retry
doar când după eroare nu urmează alt mesaj al utilizatorului.

**F-05. [CORECTAT] Răspunsul la o întrebare a agentului, scris în caseta de mesaj, nu ajunge la întrebare. [C],
găsit independent de doi revizori**
Textul intră în coadă ca „Pending delivery”, iar cardul întrebării așteaptă în continuare; fără
timeout, tura stă pe loc. Enter în câmpul de text al cardului nu trimite nimic
(`renderer/components/session/question-card.tsx:84-95`, `core/sessions/service.ts:1488-1529`).
*Reparație:* în `send()`, dacă tura activă are o întrebare deschisă și nu sunt imagini, apelează
`session.question.answer` cu `{kind:"text"}`; trimite la Enter și din câmpul cardului.

**F-06. [CORECTAT] Textul scris în compozitor se pierde la orice navigare. [V] stare locală, [C] demontare**
Textul stă într-un `useState` local (`renderer/components/session/composer.tsx:60-66`). Un clic pe
altă sesiune, pe Settings, pe Help sau pe Plugins îl șterge, deși fișierele și imaginile atașate
supraviețuiesc.
*Reparație:* un `Map` la nivel de modul, cu cheia `workbenchId/sessionId`, citit la montare și golit
la trimitere reușită.

**F-07. [PARȚIAL] Un mesaj care conține un secret stocat este respins cu „Invalid”. [V]**
`session.send`, `session.rename` și `app.settings.get` aruncă `INVALID` dacă textul conține un
secret înregistrat (`main/index.ts:1778, 1824, 1943-1949`; `main/credentials.ts:115-119`). Orice
șir de minimum 6 caractere tastat într-un câmp de cheie devine secret, chiar și o ciornă nesalvată
(`main/provider-settings.ts:95`, `main/provider-discovery.ts:47`). Exemple: cheia uzuală
`lm-studio` pentru un provider cu același identificator blochează salvarea și apoi citirea
setărilor; o parolă MQTT „mosquitto” face ca orice mesaj cu acel cuvânt să fie refuzat.
*Reparație:* nu mai respinge textul utilizatorului și citirile de setări; mascarea le acoperă deja.
Înregistrează cheia doar la salvare.

**F-08. Căutarea punctului de tăiere la compactare blochează aplicația zeci de secunde. [R] măsurat**
Fiecare candidat de tăiere renumără toată cererea, sincron, în procesul main
(`core/agent/compaction.ts:287-301`, `core/agent/context.ts:142-150`). Măsurat pe istoric sintetic:
24 s pentru 1 MB la trecerea pe un model de 32k, 165 s pentru 3,6 MB. Stop nu poate fi procesat în
acest timp.
*Reparație:* căutare binară pentru cea mai mare tăiere care încape; numără candidații fără reducere
și scade economia în loc să remăsori.

### Uneltele agentului

**F-09. [CORECTAT] `grep` și `glob` întorc rezultate goale fără semnal. [R] parțial, [V] cod**
`grep` cu `path` pe un fișier (de exemplu `logs/boot.log`) întoarce `matches: []`, pentru că
fișierul este folosit ca director de lucru (`core/tools/discovery.ts:21-22`); modelul conchide că
nu există erori. `glob: "*.log"` găsește doar nivelul de sus. Fișierele peste 5 MB și cele binare
sunt sărite fără notificare (`core/tools/grep-worker.ts:45, 53, 60`).
*Reparație:* dacă `path` este fișier, caută în el; tratează un tipar fără `/` ca `**/tipar`;
întoarce un contor `skipped`.

**F-10. [CORECTAT] `edit` strică în tăcere fișierele care nu sunt UTF-8. [C]**
Un fișier C în cp1252 cu `°` sau `µ` trece testul de „binar”; decodarea și recodarea transformă
fiecare asemenea octet în U+FFFD în tot fișierul, iar diff-ul de aprobare arată doar modificarea
cerută (`core/tools/changes.ts:148-168`, `core/tools/binary.ts:7`). Codul de la furnizori de MCU
are des asemenea fișiere.
*Reparație:* când octeții nu se regăsesc identic după o trecere prin UTF-8, decodează și codează ca
latin1.

**F-11. [CORECTAT] Pe Windows, comenzile reușite pot fi raportate ca eșuate, iar modelul nu știe ce shell
are. [R] pe PowerShell 5.1, [V] logică**
Învelișul din `core/plugins/shell.ts:198-199` pune `$LASTEXITCODE = 0`, apoi iese cu 1 dacă `$?`
este fals și `$LASTEXITCODE` este 0. În PowerShell 5.1, o comandă nativă cu `2>&1` care scrie pe
stderr și iese cu 0 dă exact acest caz. Separat, promptul de sistem spune doar „OS family”
(`core/agent/prompt.ts:109-115`), deși shell-ul poate fi pwsh, PowerShell 5.1, cmd sau Git Bash;
un model local scrie `a && b | head` și eșuează la prima încercare.
*Reparație:* pornește cu `$LASTEXITCODE = $null` și ieși cu el când este setat, altfel după `$?`.
Adaugă o linie „Shell:” în blocul Environment.

**F-12. [CORECTAT] Logul complet al unei comenzi nu poate fi citit de agent. [V] cale, [C] refuz**
`run_command` întoarce ultimele 12.000 de caractere și calea `.vera/runs/<id>.log`
(`core/plugins/command-tools.ts:117, 129`), dar `.vera/` este exclus permanent pentru `read` și
`grep` în afara modului Bypass (`core/workbench/ignore.ts:3, 53-58`). Prima eroare de compilare
dintr-un build lung este pierdută; modelul trebuie să ruleze din nou cu redirecționare, adică încă
o aprobare.
*Reparație:* permite `read` și `grep` pe `.vera/runs/*.log`, așa cum sunt permise atașamentele de
sesiune.

### Documentele

**F-13. [CORECTAT] Textul extras din PDF rupe indicii, exponenții și schimbările de font. [R], [V] cod**
În `core/knowledge/pdf-worker.ts:34-44`, orice schimbare a coordonatei y inserează o linie nouă, iar
fiecare element de pe aceeași linie primește un spațiu. Rezultatul stocat este `V\nDD`, `I\n2\nC`,
`STM32F407 VGT6`. Căutarea după „VDD” sau „I2C” ratează acele pagini. Pentru un produs construit
pe datasheet-uri, acesta este defectul cu cel mai mare efect asupra calității răspunsurilor.
*Reparație:* rupe linia doar când y se mută cu mai mult de circa jumătate din înălțimea liniei; nu
adăuga spațiu între elementele de pe aceeași linie (pdf.js le emite singur).

**F-14. [CORECTAT] Un PDF care nu este indexat se deschide ca hex dump. [V]**
Modul Rendered cere ca documentul să fie indexat, neschimbat și cu extracție stocată
(`core/workbench/service.ts:448-462`); altfel `renderer/components/documents/file-mode.ts:51-60`
alege Hex. Se întâmplă în timpul primei indexări, pentru un PDF din afara `docs.include`, eșuat,
prea mare sau modificat de la indexare.
*Reparație:* servește octeții PDF fără pagini extrase și lasă vizualizatorul să ia numărul de pagini
din pdf.js, cum face deja calea `needs_ocr`.

**F-15. [PARȚIAL] Reindex șterge tot indexul și este singura cale de a reîncerca un document. [V] ștergere,
[C] buton**
`reindex()` rulează `runPass(true)`, care elimină toate rândurile
(`core/knowledge/ingest.ts:422-438, 573-577`). Indicatorul de progres din Files este chiar butonul
Reindex și rămâne activ; un clic în timpul indexării pune în coadă o ștergere completă. La fel,
schimbarea dimensiunii fragmentelor sau a suprapunerii șterge toate rândurile
(`ingest.ts:402-419`), deși `Workbench.md` spune că se aplică doar documentelor viitoare.
*Reparație:* păstrează rândurile indexate cu hash neschimbat și reia doar restul. La schimbarea
fragmentării, refragmentează din extracția stocată, ca la schimbarea modelului de embedding.

**F-16. [CORECTAT] Citarea unei pagini dintr-un interval citit apare ca neverificată. [V]**
`withinIssued` acceptă sub-intervale doar pentru linii (`core/agent/citations.ts:19-34`). Agentul
citește paginile 45-47 și citează corect pagina 46; cipul apare cu avertisment și nu se deschide.
*Reparație:* acceptă o pagină sau un interval aflat în interiorul unui interval de pagini emis.

## 5. Frecare în fluxul zilnic

### Chat și sesiuni

| ID | Constatare | Unde | Reparație minimă |
|---|---|---|---|
| F-17 | Mesajele puse în coadă rămân „Pending delivery” după Stop, eroare sau limită, până la următorul mesaj. [C] | `core/agent/runtime.ts:568-571`, `core/sessions/service.ts:1499-1529` | Când tura se încheie cu mesaje în coadă, pornește tura următoare din ele. |
| F-18 | **[CORECTAT]** Tăierea la limita de output a modelului (4.096 implicit pe endpointuri personalizate) încheie tura fără niciun anunț. [V] | `runtime.ts:561-566`, `transcript.tsx:222-223` | Marchează tura `limit: "output"` și refolosește anunțul cu Continue. |
| F-19 | **[PARȚIAL]** Un rezumat de compactare eșuat este reîncercat la fiecare apel de model. [C] | `core/agent/compaction.ts:303-330` | Parsare tolerantă a JSON-ului; după un eșec, sari până la tura următoare. |
| F-20 | Caseta de mesaj este dezactivată la fiecare trimitere și cât așteaptă o aprobare; focusul cade pe `body`, iar tastele A/D cer un clic. [C] | `composer.tsx:108-117`, `approval-card.tsx:212-240` | Dezactivează doar Send; focalizează cardul nou; readu focusul în compozitor după decizie. |
| F-21 | **[CORECTAT]** Într-o sesiune arhivată se poate porni o tură care nu poate fi terminată (cardurile sunt dezactivate). [C] | `composer.tsx:108`, `workspace.tsx:401` | Adaugă `archived` la blocarea compozitorului. |
| F-22 | **[CORECTAT]** Căutarea în sesiuni este descrisă în Help, dar nu este cablată; lista nu are paginare. [V] | `session-list.tsx:527` (`searchChanged` nu este transmis nicăieri) | Stare de căutare și un `useQuery` în `App.tsx`. |
| F-23 | La detaliu Normal se vede doar „Operations: 3 · Running”, nu și ce face agentul. [C] | `transcript.tsx:582-588` | Adaugă la titlul grupului acțiunea și ținta uneltei care rulează. |
| F-24 | **[PARȚIAL]** După derulare în sus nu există cale rapidă înapoi la ultimul mesaj, iar un mesaj trimis apare în afara ecranului. [C] | `transcript.tsx:150-170, 252-266` | Reactivează urmărirea la mesaj nou al utilizatorului; un buton mic când nu se urmărește. |
| F-25 | **[CORECTAT]** Ctrl+F doar numără potrivirile; nu are următor/anterior și nu derulează. [C] | `workspace.tsx:356-388` | Enter și Shift+Enter derulează la potrivirea următoare/anterioară. |
| F-26 | **[CORECTAT]** Mesajul de limită de context nu oferă nicio acțiune, deși există compactarea manuală. [V] în interfață | `en.json:632`, `session-advanced.tsx:65` | Un buton „Compactează” lângă mesaj. |
| F-27 | **[CORECTAT]** Eroarea de autentificare spune „verifică Providers”, fără buton într-acolo. [V] în interfață | `error-message.tsx` | Un buton care deschide Settings → Providers. |
| F-28 | **[CORECTAT]** Un model eliminat dă „internal application error”. [C] | `runtime.ts:201-211`, `llm/providers.ts:290-292` | Mesaj „model indisponibil, alege altul”. |
| F-29 | **[PARȚIAL]** Sesiunea părinte își interoghează copiii costisitor: `session_wait` are maximum 30 s, deci un copil de 10 minute costă 20-60 de apeluri de model. [C] | `core/tools/delegated-sessions.ts:19-21` | Permite așteptări de circa 10 minute. |
| F-30 | Raționamentul (detaliu Verbose) se afișează în capul transcriptului; bufferele live nu se eliberează. [C] | `transcript.tsx:270-275`, `use-session-events.ts:20-33` | Afișează-l lângă mesajul lui; șterge `updates[callId]` la `tool.done`. |

### Unelte și aprobări

| ID | Constatare | Unde | Reparație minimă |
|---|---|---|---|
| F-31 | „Always allow” nu are niciun efect în Ask, modul implicit: prefixul se salvează, dar se aplică doar în Auto-edit. [V] | `core/agent/approvals.ts:51-58`, `approval-card.tsx:348-372` | Aplică prefixele salvate și în Ask, sau ascunde butonul în Ask. |
| F-32 | **[CORECTAT]** Comenzile uzuale de build nu pot fi salvate ca prefix: `idf.py build` (punct în primul cuvânt), `pio run -e`, `make -C`, `ninja -C`, `git -C` (regula `-c/-e` fără diferență de majuscule), `tar -xf`. [V] | `shared/command-prefix.ts:59, 77, 79` | Permite `.` în primul cuvânt; aplică regula `-c/-e` doar interpretoarelor. |
| F-33 | **[PARȚIAL]** Un PDF din afara indexului este o fundătură: `read` spune „folosește read_doc”, `read_doc` spune „neindexat, folosește read”. Descărcările ajung în `.vera/downloads`, pe care nicio unealtă nu-l citește. [C] | `core/tools/read.ts:23`, `core/knowledge/search.ts:200`, `core/tools/web-download.ts:45-76` | `read_doc` extrage la cerere un PDF neindexat, cu extractorul existent. |
| F-34 | **[PARȚIAL]** Logurile seriale reale sunt respinse: un octet invalid oprește `parse_log`; un singur NUL în primii 8 KiB face `read` să refuze și `grep` să sară fișierul; UTF-16 (ce scrie `>` în PowerShell 5.1) contează ca binar. [C] | `core/tools/parse-log-worker.ts:107-158`, `core/tools/binary.ts:4` | Decodare nefatală; raport de NUL în loc de „orice NUL”; UTF-16 după BOM. |
| F-35 | **[CORECTAT]** Căile absolute din interiorul workbench-ului (cum le tipăresc compilatoarele) sunt refuzate; regulile de nume Windows se aplică și pe Linux (`capture_12:30.log`, `aux.c` devin invizibile). [C] | `core/workbench/path-guard.ts:49-58, 203-208` | Acceptă căile absolute din rădăcină; aplică regulile de nume doar pe win32. |
| F-36 | **[CORECTAT]** Uneltele de fișiere sunt greu de folosit de modelele mici: parametri fără descriere, greșeli în descrieri („depth1 to3”), eroarea de la `edit` nu spune să se scoată prefixul `N: `. [C] | `core/tools/read.ts:13-18`, `grep.ts:5-19` | `.describe()` pe parametri; un indiciu în eroarea de la `edit`. |
| F-37 | `run_command` elimină orice variabilă de mediu cu `TOKEN`, `SECRET` sau `PASSWORD` în nume, deci `gh` și `git push` cu `GH_TOKEN` eșuează fără explicație. [C] | `core/plugins/shell.ts:26-29` | Păstrează variabilele, sau spune în eroare ce a fost scos. |

### Documente, indexare, vizualizatoare

| ID | Constatare | Unde | Reparație minimă |
|---|---|---|---|
| F-38 | **[CORECTAT]** Vizualizatorul PDF nu are „mergi la pagina N”. Find pornește de la pagina 1 și se oprește la începutul paginii. [V] `gotoRequest` netransmis, [C] rest | `document-tabs.tsx:533, 720`, `pdf-viewer.tsx:350-398` | Transmite `gotoRequest` la PdfViewer; pornește căutarea de la pagina curentă. |
| F-39 | Deschiderea unui document deja deschis îl reîncarcă complet: a doua citare în același manual de 1.500 de pagini recitește și reparsează tot fișierul. [C] | `viewer-context.tsx:277-306` | Pentru un tab cunoscut, doar selectează-l și derulează. |
| F-40 | **[CORECTAT]** Fișierele text obișnuite în embedded se deschid ca Hex: Makefile, Kconfig, `.ld`, `.dts`, `.map`, `.svd`; un `.log` cu culori ANSI contează ca binar. [V] cod | `file-mode.ts:84-107` | Analizează conținutul oricărui fișier neredat; permite 0x1B. |
| F-41 | **[PARȚIAL]** Schemele sunt neclare la scalare de 125-150 % (canvasul ignoră `devicePixelRatio`), zoomul se oprește la 200 %, iar paginile de peste 16 MP rămân goale. [V] zoom, [C] rest | `pdf-viewer.tsx:79, 118-140` | Redă la zoom × dpr în limita bugetului; adaugă 300 % și 400 %. |
| F-42 | Vizualizatorul de loguri mari: fiecare „următorul” rescanează de la octetul 0; un log care crește devine de nevizualizat (CONFLICT la fiecare adăugare). [C] | `large-text-find.ts:39-45`, `large-text-source.ts:95-139` | Scanează de la potrivirea curentă; la CONFLICT reîncearcă o dată. |
| F-43 | Orice modificare a configurației workbench-ului (un skill, un plugin) reîncarcă toate documentele deschise. [C] | `viewer-context.tsx:819-866` | Reîncarcă doar când s-a schimbat mascarea la afișare. |
| F-44 | Conținutul tab-urilor nu se eliberează niciodată; PDF-urile se redecodează la fiecare schimbare de tab. [C] | `viewer-context.tsx:232`, `pdf-viewer.tsx:183-202` | Păstrează un `Uint8Array` o singură dată; eliberează ce nu este afișat. |
| F-45 | **[CORECTAT]** Fragmentele doar din litere ale numelor de registre nu găsesc nimic: „MODER”, „BRR”, „USART” nu potrivesc `GPIOx_MODER`, `USART_BRR`. [R] | `core/storage/schema.ts:63`, `core/knowledge/keyword.ts:49-52` | Trimite și termenii cu majuscule de minimum 3 litere la indexul trigram. |
| F-46 | Redenumirea sau mutarea unui dosar recalculează toate embedding-urile. [C] | `ingest.ts:573-580` | Copiază fragmentele și vectorii de la un rând cu același sha256. |
| F-47 | **[CORECTAT]** Embedding-ul folosește un singur fir: 106 ms per fragment față de 33 ms cu patru fire. [R] măsurat | `core/knowledge/embedding-worker.ts:28` | 2-4 fire intra-op. |
| F-48 | Fișierele text ANSI și UTF-16 eșuează la indexare cu o eroare generică (de exemplu un BOM exportat din Excel cu „µF”). [C] | `core/knowledge/processor.ts:285` | Revino la windows-1252 la UTF-8 invalid; respectă BOM-ul UTF-16. |
| F-49 | Arborele de fișiere rămâne în urmă pentru fișierele neindexate și este costisitor la scară (reîncărcare completă la 300 ms în timpul indexării, fără virtualizare). [C] | `docs-tab.tsx:41-70`, `docs-tree.tsx:197, 338` | Reîmprospătare la focus; actualizare din evenimentul primit. |
| F-50 | Un lock rămas după o cădere, cu PID reutilizat, lasă workbench-ul doar în citire; singura ieșire este ștergerea manuală a `.vera/lock`. [C] | `core/workbench/service.ts:1178-1186` | Testează pipe-ul cu nume din `guard.ts`, nu PID-ul. |

### Setări, provideri, workbench

| ID | Constatare | Unde | Reparație minimă |
|---|---|---|---|
| F-51 | **[PARȚIAL]** Salvarea workbench-ului cu un câmp invalid arată „An internal application error occurred”: fragment de 100, suprapunere mai mare decât fragmentul, model implicit scris liber „gpt-5”. [V] | `workbench-editor.tsx:112-115, 145`, `model-select.tsx:23-31` | Calculează `valid` cu `workbenchPatchSchema.safeParse`; fă din ModelSelect o listă. |
| F-52 | **[CORECTAT]** După crearea unui workbench ajungi pe pagina de rezumat, nu într-o sesiune. Drumul până la primul răspuns are circa 9 clicuri. [V] în interfață | `App.tsx` (`created`) | Deschide direct o sesiune nouă după creare. |
| F-53 | **[PARȚIAL]** Părăsirea unei pagini de setări întreabă „Discard your unsaved **workbench** changes?” într-un dialog nativ. Doar bifarea „Show advanced settings” face pagina „modificată”. [V] | `App.tsx:79, 84`, `advanced-settings-panel.tsx:90-132` | Text propriu pentru setări; aplică imediat „Show advanced settings”. |
| F-54 | **[CORECTAT]** Data & privacy arată patru liste „Display / Program runs / Agent and model / Artifacts and exports” cu On/Off, fără să spună că este vorba de mascarea secretelor. [V] în interfață | `privacy-controls.tsx` | Un titlu de grup, de exemplu „Mask stored secrets in”. |
| F-55 | OpenAI: o cheie greșită nu este observată, Test este dezactivat fără motiv cât timp câmpul opțional de model este gol. [C] | `core/llm/providers.ts:489-499`, `providers.tsx:280-285` | Test folosește primul model bifat și rulează o dată după salvare. |
| F-56 | Ollama și „Other compatible provider”: numele modelului se scrie pe dinafară, deși `/v1/models` este deja interogat după salvare. [C] | `custom-provider-editor.tsx:251` | Oferă Discover și aici. |
| F-57 | **[CORECTAT]** Dialogul „Add provider” nu are Cancel pe opțiunea preselectată (ChatGPT); se închide doar cu Esc. [C] | `providers.tsx:414-452` | Un buton Cancel. |
| F-58 | **[CORECTAT]** Rezumatul workbench-ului arată modul Bypass ca „Auto-edit”. [C] | `workbench.tsx:144-148` | Adaugă eticheta Bypass. |
| F-59 | Lista de provideri nu are presetări pentru Anthropic, Google Gemini, OpenRouter sau Mistral, deși protocolul `anthropic-messages` este deja suportat. [V] | `shared/provider-presets.ts` | Adaugă cele patru presetări. |

### Pornire, oprire, terminal

| ID | Constatare | Unde | Reparație minimă |
|---|---|---|---|
| F-60 | **[PARȚIAL]** Logurile nu pot diagnostica un eșec: `ipc.internal` scrie doar canalul, erorile de pornire și de actualizare nu au mesaj sau stivă, nu există handler pentru `uncaughtException`, nu există „deschide dosarul de loguri”. [C] | `main/ipc-router.ts:63-70`, `main/index.ts:2074, 2219, 2268` | Adaugă nume, mesaj și stivă; două handlere de proces; o acțiune de deschidere a dosarului. |
| F-61 | Schimbarea workbench-ului închide terminalele utilizatorului, deși turele celui vechi continuă în fundal; un build sau un monitor serial este oprit. [V] | `main/index.ts:645-653` | Păstrează terminalele per proprietar și închide-le la eliberarea acelui runtime. |
| F-62 | Ecoul din terminal întârzie până la 250 ms: ieșirea vine doar printr-o interogare periodică ce întoarce tot bufferul. [C] | `main/terminals.ts:243-251`, `terminal-tab.tsx:61-113` | Interoghează imediat după tastare; întoarce doar coada. |

Alte observații mărunte, fără ID: oprirea aplicației nu are termen-limită și poate lăsa un proces
invizibil care ține lock-ul de instanță (`main/shutdown.ts:8-25`) [C]; `playwright-core` se încarcă
la fiecare pornire, deși browserul este opțional (175 ms în Node simplu) [R]; dictarea pierde textul
la alt-tab și calculează SHA-256 pe tot modelul de două ori per rostire [C]; Git este găsit doar în
instalări la nivel de mașină [C]; starea „maximizat” a ferestrei nu se salvează [C]; în română,
„tură” alternează cu „execuție”, „tokenuri” cu „tokeni”, iar „Verbose” este netradus [C].

## 6. Gărzi existente care întrerup un flux normal

Cererea a fost să nu propun protecții care blochează utilizatorul. Mai jos sunt protecțiile deja
existente care fac asta. Recomand relaxarea lor; niciuna nu cere cod nou de protecție.

| Garda | Ce întrerupe | Recomandare |
|---|---|---|
| **[PARȚIAL]** Respingerea textului care conține un secret stocat (F-07) | Trimiterea de mesaje, redenumirea, citirea setărilor | Elimin-o; mascarea rămâne. |
| **[CORECTAT]** Confirmare la fiecare link extern din răspuns [C] (`external-source-link.tsx:33-112`) | Cititul surselor citate | Deschide direct linkurile http(s); adresa este deja în tooltip. |
| Dialog de filtru la fiecare cip de cadru Wireshark [C] (`capture-citation.tsx:31-128`) | Urmărirea unei citări | Deschide direct. |
| **[CORECTAT]** Esc deschide „Stop the running turn?” cu Cancel focalizat [C] (`workspace.tsx:296-308`) | Oprirea turei cere Esc, Tab, Enter | Focalizează Stop. |
| Caseta de mesaj blocată cât așteaptă o aprobare (F-20) | O corecție cere întâi Deny | Pune mesajul în coadă. |
| **[CORECTAT]** Redenumirea refuzată cu BUSY în timpul unei ture [C] (`core/sessions/service.ts:1159-1160`) | Organizarea sesiunilor | Permite redenumirea. |
| Limita de 4 ture simultane cu 3 delegări [C] (`service.ts:1611-1613`) | O sesiune care delegă face ca trimiterile din altă parte să eșueze cu TURN_LIMIT | Lasă trimiterea să aștepte un loc liber. |
| O actualizare descărcată blochează închiderea cât timp rulează ceva; apoi aplicația se închide singură [V] handler, [C] amânare (`main/index.ts:2127-2133`, `main/updates.ts:161-177`) | Clicul pe X nu face nimic; închiderea vine mai târziu, poate în timpul tastării | La închiderea cerută de utilizator, închide normal; instalează doar dacă aplicația este deja inactivă. |
| **[PARȚIAL]** „Always allow” fără efect în Ask și reguli de prefix prea stricte (F-31, F-32) | Aceeași comandă de build cere aprobare de fiecare dată | Vezi F-31 și F-32. |
| `web_download` cere aprobare și în Auto-edit, apoi salvează unde agentul nu poate citi (F-33) | „Descarcă datasheet-ul și spune-mi X” | Lasă agentul să citească ce a descărcat. |
| **[CORECTAT]** Schimbarea modelului de embedding este refuzată cu CONFLICT dacă s-a mai indexat un document între timp [C] (`core/workbench/service.ts:957-972`) | Salvarea se repetă la nesfârșit cu multe fișiere mici | Renunță la compararea numărului; păstrează verificarea modelului de plecare. |
| **[CORECTAT]** Căi absolute din workbench refuzate; reguli de nume Windows pe Linux (F-35) | Modelul nu poate deschide calea tipărită de compilator | Vezi F-35. |
| Variabile de mediu cu TOKEN/SECRET/PASSWORD eliminate (F-37) | `gh`, `git push` | Vezi F-37. |
| Browserul încorporat cere acord manual per origine, inclusiv pentru subresurse, nepersistent [C] (`main/browser/policy.ts:60-118`) | Paginile cu CDN se afișează stricat | O pagină acceptată își poate încărca subresursele. |
| Confirmare după clicul explicit „Open download link” [C] (`updates.tsx:46-94`) | Actualizarea manuală | Elimină confirmarea. |
| `.vera/WORKBENCH.md` și skill-urile sunt refuzate la scriere în afara Bypass, deși `Agent.md` spune că se cere aprobare [C] | „Adaugă asta în instrucțiuni” | Aliniază codul la document: cere aprobare. |

## 7. Arhitectură, cod și teste

**Master a avut teste picate, iar nimic nu rulează suita la merge. [C]** Nu există workflow-uri în
`.gitea/` sau `.github/` și nici hook-uri Git. Commitul `8d8738df` a reparat teste lăsate în urmă de
două commituri anterioare. *Reparație:* `npm run verify` ca pas fix la integrarea unui PR, sau ca
Gitea Action.

**Mock-ul poate arăta un comportament pe care aplicația reală nu-l produce. [V]** F-04 este
exemplul: fixture-ul are `retryable: true`, producția niciodată. Mock-ul validează corect schemele,
deci deriva este de comportament, nu de formă. *Reparație:* la fixture-uri, folosește doar valori
pe care codul le poate emite; un test simplu poate verifica asta pentru evenimentele de eroare.

**Un canal IPC nou cere modificări în cinci locuri ținute de mână, două fiind liste din teste. [C]**
`main/ipc-router.test.ts:19-207` și `preload/bridge.test.ts:153-343` s-au schimbat în 43-44 din
ultimele 392 de commituri. Acesta este tiparul „testelor rămase în urmă”. *Reparație:* construiește
lista din `Object.keys(channels)`, cum face deja `main/provider-settings.test.ts:366`.

**Cele mai mari două fișiere sunt și cele mai modificate. [C]** `runTurn` are circa 690 de linii
(`core/sessions/service.ts:1621-2307`, 58 de commituri în trei săptămâni); `main/index.ts:1040-2072`
este un singur literal cu 185 de handlere (92 de commituri). Amestecul de stiluri din acel tabel
explică și un defect: `session.reasoning.get/set` așteaptă rețeaua în interiorul cozii sesiunii,
deci Stop și aprobările pot aștepta până la 30 s (`main/index.ts:1857-1876`). *Reparație:* doar
mutări mecanice, câte un fișier de handlere per spațiu de nume, după modelul `session-router.ts`.

**Codul de domeniu este 36 % din core, dar cuplat în puține puncte. [C]** `electrical/` are 9.338 de
linii, `wireshark/` 9.154, din 51.421. Doar cinci fișiere generice le importă. Costul la rulare este
mic; costul real este că fiecare domeniu nou modifică `shared/tools.ts`, `registry.ts`, `service.ts`,
`context.ts` și rendererul. *Reparație ieftină, în trei părți:* condiționează uneltele electrice
prin `ToolDefinition.available(ctx)`, cum face deja Wireshark; înlocuiește cele 23 de `export *` din
`core/src/index.ts:11-33` cu exporturi numite (din circa 146 de simboluri electrice exportate, unul
singur este folosit în afară); adaugă o regulă Biome care îngheață lista de importuri de azi. Nu
recomand o rearhitecturare.

**CLI-ul este o unealtă de repo, deși `Overview.md` îl prezintă ca funcție de produs. [C]** Nu este
inclus în pachet, nu poate crea un workbench, iar `--data` indică implicit un dosar temporar, deci
`vera run` nu vede plugin-urile și setările aplicației desktop. Erorile sunt coduri goale
(`NOT_FOUND` în afara unui workbench). `vera --version` și `vera run --help` ies cu codul 2.
*Reparație:* spune asta în `Overview.md:80`; numește calea în erori; acceptă `--help` și `--version`.

**Documentația nu se potrivește cu codul în câteva locuri. [C]** „43 de plugin-uri” față de 44 în
`plugins/catalog.yaml`; `Overview.md:120` spune că vocea nu este suportată, dar dictarea Whisper
este livrată; `getting-started.md:13` descrie un ecran „Home” care nu există; `settings.md` omite
Permissions și Advanced; Help descrie căutarea în sesiuni (F-22).

## 8. Ordine de lucru propusă

1. **Prima utilizare și reluarea după eroare:** F-01, F-03, F-04, F-07. Sunt reparații mici și
   înlătură cele mai probabile motive pentru care un utilizator nou renunță.
2. **Uneltele care mint modelul:** F-09, F-10, F-11, F-12. Afectează fiecare sesiune de lucru pe
   cod și loguri, mai ales cu modele locale.
3. **Calitatea documentelor:** F-13, F-14, F-15, F-16. F-13 cere reindexare după reparație, deci
   merită făcut înainte ca utilizatorii să indexeze volume mari.
4. **Conversația fără pierderi:** F-05, F-06, F-17, F-18, plus F-02 și F-08 pentru modelele locale.
5. **Gărzile din secțiunea 6**, în ordinea din tabel.
6. **Mentenanță:** verificarea la merge și listele de canale din teste (secțiunea 7). Reduc costul
   fiecărei schimbări următoare.

## 9. Ce nu am acoperit

- Plugin-urile, motorul lor și interiorul modulelor `electrical` și `wireshark`.
- Aplicația Electron reală, apeluri reale către modele, hardware real, Linux nativ.
- Suita de teste (nerulată) și scripturile de livrare din `02_Tools`.
- Citite doar superficial: `core/tools/browser.ts`, `apply-candidate.ts`, `core/parts/`, proxy-ul
  browserului încorporat, editorul de skill-uri, descărcările de modele pentru dictare,
  `main/git/diff.ts` și `history.ts`.
- Duratele și consumul de memorie din F-39, F-42, F-44 și F-49 sunt deduse din cod, nu măsurate.
- Neconfirmat: o eroare a watcher-ului de fișiere lasă starea „blocked” fără reîncercare automată
  (`ingest.ts:318-324`); `docs.gitignore`, activ implicit, ascunde datasheet-urile ignorate de Git
  fără să spună de ce.
