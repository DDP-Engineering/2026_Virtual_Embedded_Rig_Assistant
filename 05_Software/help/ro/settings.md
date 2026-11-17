# Setări

**Setări** din partea de jos a barei laterale deschide setările aplicației. Acestea se aplică tuturor workbenchurilor; setările unui singur workbench se află la **Editează workbenchul** (vezi [Workbenchuri](workbenches.md)). Modificările sunt salvate imediat ce le faci, cu excepția paginilor care au propriul buton **Salvează**. **Înapoi la workbenchuri** te readuce la lucru.

| Pagină | Ce setează |
|---|---|
| **Furnizori** | Accesul la modele AI; vezi [Furnizori și modele](providers.md) |
| **Acces web** | Căutarea și citirea pe web pentru agent |
| **Aspect și limbă** | Limba, tema și dimensiunile textului |
| **Notificări** | Nu este încă disponibilă |
| **Comenzi rapide** | Propriile tale combinații de taste |
| **Actualizări** | Cum se actualizează VERA |
| **Date și confidențialitate** | Valorile implicite de mascare pentru patru zone |
| **Despre** | Versiunea, runtime-ul, licența și componentele terțe |

## Date și confidențialitate

Alege dacă secretele stocate sunt înlocuite cu `[REDACTED]` în **Afișare**, **Rulări de programe**, **Agent și model** și **Artefacte și exporturi**. Afișarea și rulările sunt dezactivate implicit; agentul și modelul și artefactele și exporturile sunt activate. Sunt mascate doar secretele stocate cunoscute de VERA; alte texte sensibile nu sunt detectate automat. Erorile furnizorilor, testele de conexiune și jurnalele de diagnostic își păstrează protecția necondiționată.

Folosește **Salvează** sau **Anulează** în dreapta sus. Comutatoarele schimbă doar schița până la salvare. Dezactivarea **Agent și model** cere confirmare: secretele stocate găsite în fișiere sau în rezultatele instrumentelor pot ajunge la furnizorul modelului. Anularea sau Escape păstrează alegerea anterioară. Celelalte zone nu cer confirmare.

În **Editează workbenchul → Date și confidențialitate**, fiecare zonă are **Implicit**, **Activat** sau **Dezactivat**. Implicit arată valoarea curentă a aplicației și urmează schimbările ei; alegerile explicite aparțin workbenchului și sunt copiate cu configurația sa. Alegerea Implicit cere confirmare dacă dezactivează Agent și model. Workbenchurile noi moștenesc valorile aplicației dacă nu alegi altfel. Workbenchurile doar în citire nu pot salva modificări.

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

Pagina listează fiecare comandă cu combinația sa de taste. Poți adăuga, schimba sau elimina combinații; **Restabilește valoarea implicită** și **Restabilește toate valorile implicite** anulează modificările tale. Combinațiile folosesc Ctrl, opțional cu Alt sau Shift, și o literă, o cifră, virgula sau bara oblică; VERA refuză combinațiile rezervate sau deja atribuite. Lista implicită se află în [Scurtături de tastatură](shortcuts.md).

## Actualizări

- **Mod de actualizare**: **Oprit**, **Notifică** sau **Descarcă automat**. Cu **Notifică**, VERA te anunță când există o versiune nouă și o descarcă doar când selectezi **Descarcă actualizarea**.
- **Canal**: **Stabil** sau **Beta (include stabil)**.
- **Verifică acum** verifică imediat, inclusiv când modul este **Oprit**. Altfel, VERA verifică la pornire și la fiecare șase ore.

Când o actualizare este descărcată, selectează **Repornește pentru actualizare**. VERA așteaptă până când toate execuțiile în curs și aprobările în așteptare s-au încheiat. Fiecare actualizare este verificată înainte de instalare, iar VERA nu instalează niciodată o versiune mai veche.

Versiunea portabilă doar anunță actualizările: deschide linkul de descărcare, apoi înlocuiește folderul aplicației. O instalare Linux `.deb` se actualizează prin managerul de pachete.

**Oprit** oprește și verificarea zilnică a catalogului de pluginuri; **Caută actualizări** de pe pagina **Pluginuri** funcționează în continuare.

## Acces web

Accesul web îi permite agentului să caute pe webul public, să citească pagini publice și să descarce fișiere publice. Este activat implicit, cu Exa în mod anonim.

1. Bifează sau debifează **Activează accesul web**.
2. Alege **Provider de căutare**: Exa, Tavily sau Brave.
3. Alege **Mod de acces**: **Anonim — fără cont** sau **Folosește cheia mea API** și introdu cheia. Brave are întotdeauna nevoie de o cheie și doar caută; nu poate citi pagini.
4. Selectează **Salvează**, apoi **Testează conexiunea**.

Doar textul căutării și adresele cerute de agent părăsesc calculatorul tău; VERA nu încarcă fișiere de proiect pentru o căutare. Utilizarea anonimă este supusă limitelor furnizorului. Rezultatele web sunt tratate drept conținut nesigur, iar agentul le citează cu linkurile lor publice; la deschiderea unui link, ești întrebat înainte ca browserul să îl deschidă.

Dezactivarea accesului web oprește și căutările și descărcările în curs. Workbenchurile individuale pot dezactiva instrumentele web la **Editează workbenchul** → **Instrumente**.

## Despre

**Despre** afișează versiunea aplicației, platforma, arhitectura, dacă VERA rulează ca versiune portabilă, setările regionale ale sistemului, versiunile runtime, licența și lista componentelor terțe cu licențele lor.

## Comenzi shell

În Setări → Comenzi, alege Automat, PowerShell 7, Windows PowerShell, Cmd, Bash sau Personalizat, apoi Salvare. Variantele instalate sunt detectate în căile de căutare și în directoarele standard; cele indisponibile sunt dezactivate. Personalizat acceptă un nume de executabil sau o cale absolută. Automat preferă PowerShell 7, Windows PowerShell, apoi Cmd pe Windows; Linux preferă Bash, apoi sh. PowerShell rulează neinteractiv, fără profil și cu ieșire UTF-8. Bash folosește `-lc`; profilurile pot modifica mediul. Pe Windows, Bash înseamnă Bash nativ, de exemplu Git Bash; launcherul WSL vechi nu este selectat. Comenzile Cmd folosesc `/d /s /c`, acceptă o singură linie cu `&` sau `&&` între comenzi, iar ieșirea comenzilor interne folosește pagina de cod Windows. Pentru ieșire UTF-8, folosește PowerShell sau Bash. Setarea se aplică următoarelor comenzi ale agentului și terminalelor noi; terminalele existente păstrează shell-ul curent. Un shell ales explicit, dar indisponibil produce o eroare.
