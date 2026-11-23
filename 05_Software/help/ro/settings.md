# Setări

**Setări** din partea de jos a barei laterale deschide setările aplicației. Acestea se aplică tuturor workbench-urilor; setările unui singur workbench se află la **Editează workbench-ul** (vezi [Workbench-uri](workbenches.md)). Modificările de pe o pagină rămân o ciornă până apeși **Salvează**, în dreapta sus; **Anulează** renunță la ele. Modificările de aspect se văd imediat pe ecran, înainte de salvare. Dacă părăsești o pagină cu modificări nesalvate, VERA te întreabă dacă renunți la ele sau rămâi. **Înapoi la workbench-uri** te readuce la lucru.

| Pagină | Ce setează |
|---|---|
| **Furnizori** | Accesul la modele AI; vezi [Furnizori și modele](providers.md) |
| **Acces web** | Căutarea și citirea pe web pentru agent |
| **Aspect și limbă** | Limba, tema și dimensiunile textului |
| **Comenzi** | Shell-ul pentru comenzile agentului și terminalele noi |
| **Notificări** | Alerte desktop pentru finalizarea turelor și cereri de aprobare |
| **Comenzi rapide** | Propriile tale combinații de taste |
| **Actualizări** | Cum se actualizează VERA |
| **Date și confidențialitate** | Valorile implicite de mascare pentru patru zone |
| **Despre** | Versiunea, runtime-ul, licența și componentele terțe |
| **Dictare** | Modele Whisper locale și limba vorbită |

## Notificări

La **Finalizarea unei ture** poți alege **Niciodată**, **În fundal** (implicit) sau **Întotdeauna**. VERA este în fundal când fereastra este minimizată, ascunsă sau nu este activă.

Opțiunea **Cereri de aprobare în fundal** este activată implicit. Verifică cererile și răspunde în VERA. Cererile în așteptare apar în bara laterală și în conversație.

Apasă pe bannerul unei alerte cât timp rulează VERA pentru a deschide sesiunea. VERA îți cere confirmarea înainte de a renunța la modificările nesalvate.

Pe Windows, alertele desktop necesită instalarea VERA. Versiunea ZIP portabilă folosește indicatorii sesiunilor și cardurile de aprobare din VERA. Pe Linux, alertele desktop necesită un serviciu de notificări desktop. În mediile compatibile, sistemul de operare decide dacă afișează alertele cât timp rulează VERA. Dacă alertele lipsesc, verifică setările de notificări ale sistemului pentru VERA și modul Nu deranja. Indicatorii sesiunilor și cardurile de aprobare rămân disponibile în aplicație.

## Date și confidențialitate

Alege dacă secretele stocate sunt înlocuite cu `[REDACTED]` în **Afișare**, **Rulări de programe**, **Agent și model** și **Artefacte și exporturi**. Afișarea și rulările sunt dezactivate implicit; agentul și modelul și artefactele și exporturile sunt activate. Sunt mascate doar secretele stocate cunoscute de VERA; alte texte sensibile nu sunt detectate automat. Erorile furnizorilor, testele de conexiune și jurnalele de diagnostic își păstrează protecția necondiționată.

Folosește **Salvează** sau **Anulează** în dreapta sus. Comutatoarele schimbă doar schița până la salvare. Dezactivarea **Agent și model** cere confirmare: secretele stocate găsite în fișiere sau în rezultatele instrumentelor pot ajunge la furnizorul modelului. Anularea sau Escape păstrează alegerea anterioară. Celelalte zone nu cer confirmare.

În **Editează workbench-ul → Date și confidențialitate**, fiecare zonă are **Implicit**, **Activat** sau **Dezactivat**. Implicit arată valoarea curentă a aplicației și urmează schimbările ei; alegerile explicite aparțin workbench-ului și sunt copiate cu configurația sa. Alegerea Implicit cere confirmare dacă dezactivează Agent și model. Workbench-urile noi moștenesc valorile aplicației dacă nu alegi altfel. Workbench-urile doar în citire nu pot salva modificări.

Dezactivarea mascării nu recuperează conținutul deja salvat ca `[REDACTED]`, inclusiv istoricul sesiunilor și artefactele. Citește-l sau recreează-l din sursa originală. Activarea mascării nu șterge istoricul brut salvat anterior.

## Aspect și limbă

- **Limba interfeței**: **Sistem**, **English**, **Română**, **Deutsch** sau **Français**. **Sistem** folosește limba sistemului de operare atunci când este una dintre aceste patru și engleza în rest. Datele calendaristice și numerele urmează limba interfeței, iar Ajutorul este afișat tot în ea.
- **Temă**: **Luminoasă**, **Întunecată** sau **Sistem**.
- Trei dimensiuni de text separate, fiecare de la **Foarte mic** la **Maxim**, cu previzualizare:
  - **Dimensiunea textului interfeței**: meniuri, etichete, butoane și aranjamentul din jurul lor.
  - **Dimensiunea textului conversației**: mesajele unei sesiuni.
  - **Dimensiunea codului și a rezultatelor**: blocuri de cod, ieșirea instrumentelor și conținutul fișierelor.
- **Restabilește dimensiunile implicite** readuce toate trei la valorile implicite.

## Comenzi rapide

Pagina listează fiecare comandă cu combinația sa de taste. Poți adăuga, schimba sau elimina combinații; **Restabilește valoarea implicită** și **Restabilește toate valorile implicite** anulează modificările tale. Combinațiile folosesc Ctrl, opțional cu Alt sau Shift, și o literă, o cifră, virgula sau bara oblică; VERA refuză combinațiile rezervate sau deja atribuite. Lista implicită se află în [Comenzi rapide](shortcuts.md).

## Actualizări

- **Mod de actualizare**: **Oprit**, **Notifică** sau **Descarcă automat**. Cu **Notifică**, VERA te anunță când există o versiune nouă și o descarcă doar când selectezi **Descarcă actualizarea**.
- **Canal**: **Stabil** sau **Beta (include stabil)**.
- **Verifică acum** verifică imediat, inclusiv când modul este **Oprit**. Altfel, VERA verifică la pornire și la fiecare șase ore sau la **Intervalul verificării actualizărilor** din [Setări avansate](advanced-settings.md).

Când o actualizare este descărcată, selectează **Repornește pentru actualizare**. VERA așteaptă până când toate execuțiile în curs și aprobările în așteptare s-au încheiat. Fiecare actualizare este verificată înainte de instalare, iar VERA nu instalează niciodată o versiune mai veche.

Versiunea portabilă doar anunță actualizările: deschide linkul de descărcare, apoi înlocuiește folderul aplicației. O instalare Linux `.deb` se actualizează cu apt. Adaugă o singură dată depozitul VERA:

1. Instalează cheia lui de semnare: `wget -qO- https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/latest/download/vera-archive-keyring.gpg | sudo tee /usr/share/keyrings/vera-archive-keyring.gpg > /dev/null`
2. Adaugă depozitul: `echo "deb [signed-by=/usr/share/keyrings/vera-archive-keyring.gpg] https://github.com/DDP-Engineering/2026_Virtual_Embedded_Rig_Assistant/releases/latest/download/ /" | sudo tee /etc/apt/sources.list.d/vera.list`
3. Actualizează VERA odată cu sistemul: `sudo apt update && sudo apt upgrade`

Fără depozit, selectează **Deschide linkul de descărcare** pe pagina **Actualizări** și instalează fișierul descărcat cu `sudo apt install ./VERA-<v>-linux-amd64.deb`.

**Oprit** oprește și verificarea zilnică a catalogului de pluginuri; **Caută actualizări** de pe pagina **Pluginuri** funcționează în continuare.

## Acces web

Accesul web îi permite agentului să caute pe webul public, să citească pagini publice și să descarce fișiere publice. Este activat implicit, cu Exa în mod anonim.

1. Bifează sau debifează **Activează accesul web**.
2. Alege **Furnizor de căutare**: Exa, Tavily sau Brave.
3. Alege **Mod de acces**: **Anonim — fără cont** sau **Folosește cheia mea API** și introdu cheia. Brave are întotdeauna nevoie de o cheie și doar caută; nu poate citi pagini.
4. Selectează **Salvează**, apoi **Testează conexiunea**.

Doar textul căutării și adresele cerute de agent părăsesc calculatorul tău; VERA nu încarcă fișiere de proiect pentru o căutare. Utilizarea anonimă este supusă limitelor furnizorului. Rezultatele web sunt tratate drept conținut nesigur, iar agentul le citează cu linkurile lor publice; la deschiderea unui link, ești întrebat înainte ca browserul să îl deschidă.

Dezactivarea accesului web oprește și căutările și descărcările în curs. Workbench-urile individuale pot dezactiva instrumentele web la **Editează workbench-ul** → **Instrumente**.

### Browser interactiv

În **Setări → Acces web**, selectează **Instalează browserul** pentru a descărca și verifica Chromium. Poți anula instalarea sau elimina browserul. Bifează **Activează browserul interactiv în VERA** și **Permite browserul interactiv în acest workbench**. Ambele opțiuni sunt inițial dezactivate. Fără rețea, selectează **Instalează din fișier…** și alege arhiva browserului dintr-o livrare VERA (vezi [Instalare offline](offline-install.md)).

În chat, introdu la **Origine publică** originea exactă, de exemplu `https://example.com`, apoi selectează **Acordă acces**. Include protocolul și portul dacă diferă de cel implicit. Fiecare chat are propriile autorizări și propria fereastră. Autorizează individual originile suplimentare pentru redirecționări sau resurse.

Cere agentului să deschidă și să citească o pagină sau să urmeze un link. Chatul arată activitatea și pagina autorizată. **Arată browserul** aduce fila în prim-plan. **Oprește navigarea** oprește tura și anulează operația în curs. **Revocă accesul** și **Închide browserul** închid sesiunea temporară și șterg autorizările. Închiderea ferestrei, dezactivarea oricărei opțiuni sau eliminarea browserului revocă accesul. Pentru fișierele acceptate, folosește descărcarea gestionată.

## Despre

**Despre** afișează versiunea aplicației, platforma, arhitectura, dacă VERA rulează ca versiune portabilă, setările regionale ale sistemului, versiunile runtime, licența și lista componentelor terțe cu licențele lor.

## Comenzi shell

În Setări → Comenzi, alege Automat, PowerShell 7, Windows PowerShell, Cmd, Bash sau Personalizat, apoi Salvare. Variantele instalate sunt detectate în căile de căutare și în directoarele standard; cele indisponibile sunt dezactivate. Personalizat acceptă un nume de executabil sau o cale absolută. Automat preferă PowerShell 7, Windows PowerShell, apoi Cmd pe Windows; Linux preferă Bash, apoi sh. PowerShell rulează neinteractiv, fără profil și cu ieșire UTF-8. Bash folosește `-lc`; profilurile pot modifica mediul. Pe Windows, Bash înseamnă Bash nativ, de exemplu Git Bash; launcherul WSL vechi nu este selectat. Comenzile Cmd folosesc `/d /s /c`, acceptă o singură linie cu `&` sau `&&` între comenzi, iar ieșirea comenzilor interne folosește pagina de cod Windows. Pentru ieșire UTF-8, folosește PowerShell sau Bash. Setarea se aplică următoarelor comenzi ale agentului și terminalelor noi; terminalele existente păstrează shell-ul curent. Un shell ales explicit, dar indisponibil produce o eroare.

## Dictare

Alege **Whisper Small** (recomandat) sau **Whisper Base** (compact). Pagina afișează dimensiunea descărcării și starea instalării pentru fiecare model. Alege **Descarcă** și urmărește progresul. **Anulează** șterge descărcarea parțială. Dacă VERA raportează o descărcare eșuată sau fișiere deteriorate, alege **Reîncearcă**. Eliberează spațiu pe disc dacă este necesar. Fără rețea, selectează **Instalează din fișier…** la model și alege arhiva lui dintr-o livrare VERA.

După instalare, alege **Folosește modelul**. VERA păstrează selecția la repornire. **Elimină** șterge fișierele modelului și golește selecția dacă modelul era activ. Dacă eliminarea eșuează, închide aplicațiile care folosesc fișierele modelului și alege **Reîncearcă**. Modelele se află în datele aplicației VERA și sunt comune tuturor workbench-urilor.

La **Limba vorbită**, alege **Detectare automată** sau selectează limba în care vei vorbi.

Alege **Ține apăsat pentru a vorbi** (modul implicit) ca să ții apăsat butonul microfonului sau comanda lui cât timp vorbești. Alege **Apasă pentru a porni sau a opri** pentru două apăsări separate. Selectează **Adaugă comandă rapidă** în fila Dictare pentru a atribui o combinație valabilă în VERA. Editorul respinge combinațiile rezervate și pe cele deja folosite. Poți folosi butonul microfonului și fără comandă rapidă.
