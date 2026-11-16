# Permisiuni

Modul de permisiuni decide ce poate face agentul fără să te întrebe: să modifice fișiere, să descarce fișiere și să ruleze programele pluginurilor pe bancul tău de lucru. Citirea workbenchului, căutarea în documente și salvarea artefactelor nu necesită niciodată aprobare.

## Alege un mod

Alege modul cu **Mod de permisiuni** de lângă caseta de mesaj. Se aplică sesiunii respective și poate fi schimbat oricând, inclusiv în timpul unei execuții. Sesiunile noi pornesc cu modul implicit al workbenchului din **Editează workbenchul** → **Agent și chat** → **Permisiuni**; un workbench nou pornește cu **Întreabă**.

| Mod | Modificări de fișiere | Programe |
|---|---|---|
| **Doar citire** | Nu sunt permise; agentul nu are instrumente de scriere | Doar comenzile clasificate **Sigur** |
| **Întreabă** | Fiecare modificare așteaptă aprobarea ta | **Citire dispozitiv** și **Scriere dispozitiv** cer aprobare; **Ireversibil** cere aprobare cu un cuvânt tastat |
| **Editare automată** | Modificările din workbench se aplică fără întrebare; descărcările cer în continuare aprobare; fișierele din `.vera/` nu pot fi modificate | **Citire dispozitiv** rulează; **Scriere dispozitiv** cere aprobare; **Ireversibil** cere aprobare cu un cuvânt tastat |
| **Bypass — acces complet** | Citește și modifică fișiere oriunde are acces contul tău, fără să întrebe | Totul, cu excepția **Blocat**, rulează fără întrebare |

Trecerea la un mod mai strict anulează aprobările date agentului în modul anterior.

## Bypass

Fiecare trecere la Bypass îți cere mai întâi să confirmi că agentul poate citi și modifica fișiere și rula programe în orice dosar accesibil contului tău din sistemul de operare, inclusiv în afara workbenchului. Alege **Activează Bypass** pentru a aplica schimbarea. **Anulează** sau Escape păstrează modul anterior. Fiecare nouă trecere la Bypass cere confirmare, inclusiv după repornirea VERA; modul selectat rămâne marcat cu roșu. Aceeași confirmare listează regulile ireversibile ale pluginurilor activate, fără probleme și care nu sunt de probă.

Dosarul de date al aplicației VERA, inclusiv setările, credențialele salvate, pluginurile instalate și înregistrările de verificare, este refuzat instrumentelor de fișiere ale agentului în orice mod, atât la citire, cât și la scriere, inclusiv prin aliasuri de cale. VERA continuă să își gestioneze normal setările și pluginurile. Sunt disponibile doar instrumentele activate; se aplică permisiunile sistemului, limitele instrumentelor și aprobările pluginurilor de probă. Agentul nu poate modifica `.vera/workbench.yaml` sau `.vera/plugins`.

Instrumentele obișnuite de fișiere pot accesa căi din afara workbenchului în Bypass. Directoarele de lucru ale programelor, analiza jurnalelor și registrelor capturate și schițele de pluginuri rămân deocamdată în workbench. Indexul documentelor, artefactele, jurnalele execuțiilor și `.vera/` rămân în workbench.

## Aprobă sau refuză

Când agentul are nevoie de decizia ta, în conversație apare un card de aprobare, iar sesiunea afișează **Așteaptă aprobare**.

- Pentru o modificare de fișier, cardul afișează fișierul și **Diferențe unificate** ale modificării.
- Pentru o descărcare, afișează adresa sursei și dimensiunea maximă.
- Pentru un program, afișează nivelul de risc, **Plugin**, **Linie de comandă**, **Director de lucru**, **Executabil**, **Note ale regulilor** și fișierele workbenchului folosite de comandă, cu SHA-256 al lor.

Selectează **Aprobă** sau **Refuză**. **Aprobă și treci la editare automată** aprobă și trece sesiunea la **Editare automată**. Cu cardul în focus, A aprobă și D refuză.

Pentru o comandă ireversibilă, cardul spune că modificarea este permanentă și numește un cuvânt, de obicei comanda, de exemplu `burn-efuse`. Tastează acel cuvânt, apoi aprobă. Un cuvânt care nu se potrivește lasă cardul în așteptare.

## Nivelurile de risc ale programelor

Fiecare plugin își clasifică comenzile. VERA compară linia de comandă exactă cu aceste reguli înainte de a rula ceva.

| Nivel | Semnificație |
|---|---|
| **Sigur** | Nu citește nimic de pe un dispozitiv și nu modifică nimic, de exemplu afișarea unei versiuni |
| **Citire dispozitiv** | Citește de pe un dispozitiv conectat, de exemplu un ID de cip sau memoria |
| **Scriere dispozitiv** | Scrie pe un dispozitiv, de exemplu programarea flash sau ștergerea |
| **Ireversibil** | Modifică permanent un dispozitiv, de exemplu arderea eFuse-urilor sau blocarea lui |
| **Blocat** | Nu rulează niciodată, în niciun mod |

O comandă care nu se potrivește cu nicio regulă este tratată ca **Scriere dispozitiv**. Când se potrivesc mai multe reguli, se aplică nivelul cel mai ridicat. Poți vedea regulile unui plugin înainte de a-l instala, în secțiunea sa **Operații**; vezi [Pluginuri](plugins.md).

## Verifică modificările

Fila **Modificări** din panoul din dreapta listează fișierele modificate în sesiune, în ordine, cu numărul de linii adăugate și eliminate. Selectează o intrare pentru a-i vedea diferențele; **Arată în folder** afișează fișierul în managerul de fișiere. Vezi și [Chat și sesiuni](chat-and-sessions.md).
