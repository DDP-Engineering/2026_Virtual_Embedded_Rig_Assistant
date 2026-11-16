# Chat și sesiuni

O sesiune este o conversație cu agentul în cadrul unui workbench. VERA salvează fiecare sesiune în workbench, așa că poți închide aplicația și continua mai târziu. Mai multe sesiuni pot rula în același timp.

## Pornește și gestionează sesiuni

- **Sesiune nouă** pornește o conversație în workbenchul deschis. Dacă există o sesiune goală nefolosită, VERA o deschide pe aceea în loc să creeze alta.
- Primul mesaj devine titlul. **Redenumește** setează un titlu ales de tine.
- **Caută sesiuni** găsește sesiuni după titlu și după textul mesajelor.
- Fiecare rând de sesiune afișează ora ultimei activități și are un meniu cu **Exportă Markdown**, **Exportă JSON**, **Redenumește**, **Mută mai sus**, **Mută mai jos**, **Arhivează** și **Șterge**.
- O sesiune își afișează starea: **Inactiv**, **În lucru**, **Așteaptă aprobare** sau **Eroare**.

## Scrie un mesaj

Scrie în caseta de mesaj (**Întreabă VERA despre proiect…**). Enter trimite, Shift+Enter adaugă un rând, iar @ completează căile fișierelor din workbench. Pentru a-i da agentului un fișier, alege **Atașează ca context** pe acel fișier în fila **Fișiere**; fișierul apare ca etichetă deasupra casetei de mesaj.

Lângă caseta de mesaj alegi **Model**, **Nivel de reasoning** și **Mod de permisiuni** pentru această sesiune. Sesiunile noi preiau modelul și modul de permisiuni din setările workbenchului.

## Ghidează sau oprește o execuție în curs

Cât timp agentul lucrează, poți continua să scrii și să trimiți mesaje, de exemplu „verifică și errata”. Acestea afișează **În așteptarea livrării** până când agentul le preia la pasul următor. Cât timp un card de aprobare așteaptă decizia ta, trimiterea este suspendată.

**Oprește** încheie execuția curentă. Și Escape întreabă **Oprești execuția curentă?**. Lucrul deja finalizat, cum ar fi modificările de fișiere aplicate, rămâne.

## Niveluri de detaliu

**Nivel de detaliu** se setează pentru fiecare workbench în **Editează workbenchul** → **Agent și chat**:

| Nivel | Ce afișează conversația |
|---|---|
| **Verbose** | Fiecare apel de instrument cu argumentele și rezultatul său, raționamentul modelului și statistici de tokenuri sub fiecare mesaj al tău |
| **Normal** | Apelurile de rutină ale instrumentelor, grupate într-o linie extensibilă **Operații** |
| **Minimal** | Doar conversația; apelurile de rutină ale instrumentelor sunt ascunse, iar un indicator de lucru este afișat cât timp agentul lucrează |

Aprobările care te așteaptă, erorile și cardurile de descărcare sunt afișate la orice nivel; aprobările acordate de modul de permisiuni sunt ascunse la **Minimal** și grupate la **Normal**. Nivelul schimbă doar afișarea; sesiunea salvată și exporturile ei sunt întotdeauna complete.

## Raționament

Pentru modelele care îl acceptă, **Nivel de reasoning** oferă **Implicit** și nivelurile declarate de model, de exemplu **Minim**, **Redus**, **Mediu**, **Ridicat** sau **Maxim**. Nivelurile mai ridicate gândesc mai mult înainte de a răspunde. Pentru modelele fără niveluri de raționament, controlul este ascuns. Îl poți schimba în timpul unei execuții; noul nivel se aplică următoarei cereri. Textul raționamentului este afișat doar la **Verbose**.

## Sesiuni lungi și context

Indicatorul de context afișează **Context utilizat** ca procent din fereastra de context a modelului; selectează-l pentru utilizare și limite. Când o sesiune devine prea lungă pentru model, VERA rezumă istoricul mai vechi (**Se rezumă istoricul…**). Transcriptul complet rămâne salvat și vizibil.

**Caută în conversație** caută în sesiunea curentă. Banda de marcaje de la marginea stângă a conversației are câte un marcaj pentru fiecare mesaj al tău; indică un marcaj pentru a previzualiza mesajul și selectează-l pentru a sări la el.

## Arhivează, șterge și exportă

- **Arhivează** mută o sesiune încheiată în **Sesiuni arhivate**; **Restaurează** o readuce. Nu se pierde nimic.
- **Șterge** elimină sesiunea și artefactele ei după o confirmare. Fișierele descărcate de agent rămân în workbench.
- **Exportă Markdown** scrie un transcript lizibil cu rezumate ale instrumentelor, citări și modificări aplicate; **Exportă JSON** scrie înregistrarea completă a evenimentelor. Ambele deschid un dialog de salvare și funcționează și în workbenchurile doar pentru citire.

Marcajele salvate ale mesajelor rămân în exporturile JSON; Markdown indică mesajele utilizatorului cu marcaj. Marcajele aparțin sesiunii și nu sunt trimise agentului.

## Panoul din dreapta

**Arată sau ascunde panoul din dreapta** afișează file pentru sesiunea deschisă: **Context** (instrucțiunile workbenchului și skill-urile disponibile), **Fișiere**, **Modificări**, **Artefacte** (rezultatele text salvate de agent, cu **Exportă** și **Arată în folder**), **Plan** (lista de sarcini a agentului) și **Rulări** (rulările de programe ale pluginurilor).

## Marcaje

Treci cu indicatorul peste un mesaj propriu sau folosește Tab pentru a ajunge la pictograma de marcaj. Alege **Marchează**; pictograma plină oferă **Elimină marcajul**. Previzualizarea de pe margine arată primul rând al mesajului și începutul răspunsului agentului, cu aceeași acțiune de marcaj. Modificarea apare imediat; dacă salvarea eșuează, starea anterioară revine și apare o eroare. În sesiunile arhivate și workbench-urile doar pentru citire poți doar consulta marcajele.

Marcajele de pe margine sunt pline, în culoarea principală și puțin mai lungi. Un grup este marcat dacă oricare mesaj din el are un marcaj. Folosește **Marcajul următor** (**Ctrl+Alt+N**) sau **Marcajul anterior** (**Ctrl+Alt+P**) pentru a sări între mesaje; navigarea se oprește la primul sau ultimul marcaj. Modifică tastele în **Setări → Comenzi rapide**.
