# Setări avansate

Setările avansate reglează limite pe care majoritatea utilizatorilor nu trebuie să le schimbe. Sunt ascunse până activezi **Arată setările avansate** în **Setări** → **Avansat**. Dezactivarea comutatorului doar le ascunde: valorile setate deja se aplică în continuare.

## Unde se găsesc

- **Setări** → **Avansat**: valori pentru toată aplicația.
- **Editează workbench-ul** → **Avansat**: valori pentru un workbench, salvate odată cu workbench-ul. Sunt păstrate în `.vera/workbench.yaml`.
- Meniul sesiunii (**…** lângă o sesiune) → **Setări avansate**: valori pentru o singură conversație. **Salvează** le păstrează cu sesiunea și rămân după repornire; **Anulează** închide fără modificări.

## Ce valoare se aplică

Valoarea sesiunii are prioritate față de cea a workbench-ului, care are prioritate față de valoarea aplicației, iar aceasta față de valoarea implicită. Un câmp gol moștenește valoarea; arată valoarea moștenită și de unde vine, de exemplu „50 (implicit)”. **Resetează** șterge valoarea la acel nivel. O valoare de workbench sau de sesiune poate fi mai mare sau mai mică decât cea a aplicației.

O valoare în afara intervalului unei setări este refuzată când o introduci. O valoare editată manual într-un fișier și aflată în afara intervalului este ignorată și se aplică nivelul următor.

## Când se aplică o modificare

Iconița de lângă fiecare setare arată când intră în vigoare o modificare: imediat, la următorul terminal, proces, rulare sau sesiune deschisă, după reindexare, după redeschiderea workbench-ului sau după repornirea VERA.

## Setări

Fiecare setare apare doar la nivelurile enumerate. Un comutator oferă **Moștenit**, **Activat** și **Dezactivat**; **Moștenit** arată starea moștenită, de exemplu „Activat (implicit)”. **Rânduri pe pagină** oferă **Moștenit**, 10, 20 și 50.

| Setare | Niveluri | Interval | Implicit | Se aplică |
|---|---|---|---|---|
| Apeluri de instrumente pe tură | aplicație, workbench, sesiune | 10–500 | 50 | Imediat |
| Timp fără răspuns de la model (s) | aplicație, sesiune | 30–3600 | 300 | Imediat |
| Așteptarea antetelor la furnizori găzduiți (s) | aplicație | 10–300 | 30 | Imediat |
| Compactare în fundal | aplicație, workbench | Activat / Dezactivat | Activat | Imediat |
| Prag de compactare (%) | aplicație, workbench | 50–95 | 80 | Imediat |
| Istoric recent păstrat întocmai (tokeni) | aplicație, workbench | 0–100000 | 20000 | Imediat |
| Mărimea rezultatelor de instrumente în rezumat (caractere) | aplicație | 500–8000 | 2000 | Imediat |
| Treceri de rezumare pe cerere | aplicație | 1–10 | 5 | Imediat |
| Marjă de calibrare (%) | aplicație | 100–150 | 110 | Imediat |
| Folosește numărarea tokenilor de la furnizor | aplicație | Activat / Dezactivat | Activat | Imediat |
| Sesiuni delegate simultan | aplicație | 1–8 | 3 | Imediat |
| Ture simultane | aplicație | 1–16 | 3 | Imediat |
| Compactare automată | sesiune | Activat / Dezactivat | Activat | Imediat |
| Mărimea rezultatului unui instrument (caractere) | aplicație | 8000–128000 | 32000 | Imediat |
| Fereastra de citire (linii) | aplicație | 500–10000 | 2000 | Imediat |
| Mărimea textului citit (caractere) | aplicație | 10000–120000 | 30000 | Imediat |
| Rezultate grep | aplicație | 50–2000 | 500 | Imediat |
| Mărimea fișierelor pentru grep (MiB) | aplicație | 1–50 | 5 | Imediat |
| Rezultate glob | aplicație | 100–5000 | 500 | Imediat |
| Termen pentru procese worker (s) | aplicație | 5–120 | 10 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Rezultate căutare web | aplicație | 1–8 | 5 | Imediat |
| Mărimea citirii web (caractere) | aplicație | 1000–16000 | 12000 | Imediat |
| Timp de așteptare pentru cereri web (s) | aplicație | 5–120 | 30 | Imediat |
| Mărimea descărcării (MiB) | aplicație | 10–1000 | 100 | Imediat |
| Limita de timp a descărcării (s) | aplicație | 30–1800 | 120 | Imediat |
| Programe în fundal pe sesiune | aplicație | 1–16 | 4 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Loguri de rulare păstrate | aplicație | 20–2000 | 200 | Imediat |
| Mărimea logului de rulare (MiB) | aplicație | 8–1024 | 64 | Imediat |
| Plafonul de timp pentru programe (s) | aplicație, workbench | 60–3600 | 600 | Imediat |
| Plafonul de timp pentru comenzi shell (s) | aplicație, workbench | 60–3600 | 600 | Imediat |
| Mărimea maximă a fișierelor text (MiB) | workbench | 1–64 | 20 | După reindexare |
| Avertisment de volum: fișiere | aplicație, workbench | 500–100000 | 2000 | Imediat |
| Avertisment de volum: mărime (MiB) | aplicație, workbench | 512–51200 | 2048 | Imediat |
| Rezultate în panoul Docs | aplicație, workbench | 10–100 | 20 | Imediat |
| Limita de timp pentru extragerea documentelor (s) | aplicație | 30–1800 | 120 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Pauza de indexare (ms) | aplicație | 250–10000 | 1000 | Imediat |
| Timpul de inactivitate al procesului de embedding (s) | aplicație | 10–600 | 60 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Terminale pe workbench | aplicație | 1–16 | 8 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Memoria terminalului (Ki caractere) | aplicație | 64–1024 | 256 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Istoricul terminalului (linii) | aplicație | 1000–50000 | 3000 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Ieșirea terminalului pentru agent (caractere) | aplicație | 2000–64000 | 12000 | Imediat |
| Intervalul verificării actualizărilor (h) | aplicație | 1–168 | 6 | Imediat |
| Intervalul verificării catalogului de pluginuri (h) | aplicație | 1–168 | 24 | Imediat |
| Păstrarea logurilor (zile) | aplicație | 1–90 | 7 | Imediat |
| Rânduri de conversație afișate la început | aplicație | 20–200 | 40 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Rânduri de conversație pe încărcare | aplicație | 50–500 | 100 | La următorul terminal, proces, rulare sau sesiune deschisă |
| Rânduri pe pagină | aplicație | 10, 20, 50 | 10 | Imediat |

**Apeluri de instrumente pe tură** este numărul de apeluri de instrumente pe care agentul le poate face într-o tură. Când limita este atinsă, tura se oprește și spune asta; trimite un alt mesaj ca să continui.

**Timp fără răspuns de la model** este cât poate un model găzduit să nu trimită nimic înainte ca cererea să se încheie cu timeout; mărește-l pentru modele de raționament lente. **Așteptarea antetelor la furnizori găzduiți** este cât așteaptă VERA ca un furnizor găzduit să înceapă să răspundă. Un endpoint personalizat folosește pentru ambele propriul **Timp de așteptare a răspunsului**.

**Compactarea contextului.** Când o conversație ocupă mai mult decât **Pragul de compactare** din bugetul de intrare al modelului, VERA rezumă istoricul anterior și păstrează întocmai partea cea mai recentă (**Istoric recent păstrat întocmai**, cel mult o cincime din buget). Cu **Compactare în fundal** activată, rezumatul rulează imediat după o tură; dezactivată, următorul mesaj rezumă întâi, când e nevoie. **Mărimea rezultatelor de instrumente în rezumat** și **Treceri de rezumare pe cerere** limitează cât din fiecare rezultat de instrument intră într-un rezumat și câte rezumate poate face o cerere. Cu **Compactare automată** dezactivată, o sesiune trimite tot istoricul până nu mai încape; tura se oprește apoi la limita de context.

**Numărarea tokenilor.** VERA numără o cerere cu raportul raportat de furnizor pentru cererile anterioare, plus **Marja de calibrare**: 110 numără de 1,1 ori. Mărește marja când apar erori de limită de context. Dezactivează **Folosește numărarea tokenilor de la furnizor** când un furnizor raportează greșit consumul; VERA numără atunci cu estimarea sa conservatoare.

**Sesiuni delegate simultan** este câte sesiuni delegate pot rula în același timp. O sesiune în plus este refuzată până se termină una.

**Ture simultane** este câte ture ale agentului pot rula în același timp în toate workbench-urile deschise, inclusiv sesiunile delegate. O tură care așteaptă aprobarea ta contează până se termină. La limită, un mesaj nou nu este trimis și rămâne în caseta de mesaj, cu atașamentele lui; după ce se termină o tură, VERA arată că poate începe o tură și îl trimiți din nou. Un mesaj către o sesiune a cărei tură rulează se alătură acelei ture și este acceptat întotdeauna. O sesiune delegată pornită la limită este refuzată imediat. Micșorarea valorii nu oprește nicio tură în curs; se aplică de la mesajul următor.

**Documente.** **Mărimea maximă a fișierelor text** limitează documentele text; PDF-urile și fișierele Office folosesc **Dimensiune maximă fișier** din **Documente și RAG**, care le crește sau le coboară limita până la 500 MB. Modificarea oricăreia reindexează documentele afectate. **Avertismentul de volum** stabilește când previzualizarea Documentelor avertizează despre o selecție mare. **Rezultate în panoul Docs** este câte rezultate listează o căutare din panoul Docs. **Limita de timp pentru extragerea documentelor** este timpul de bază pentru citirea unui PDF sau document Office (PDF-urile mari primesc mai mult), inclusiv pentru PDF-urile descărcate. **Pauza de indexare** este cât așteaptă indexarea după o modificare, iar **Timpul de inactivitate al procesului de embedding** cât timp este păstrat un proces de embedding nefolosit.

**Desktop.** **Terminale pe workbench** limitează terminalele deschise; micșorarea nu închide niciunul, dar unul nou este refuzat cât timp limita este atinsă. **Memoria terminalului** este câtă ieșire păstrează fiecare terminal, citită la deschidere, iar **Istoricul terminalului** câte linii poți derula înapoi. **Ieșirea terminalului pentru agent** este cât din ieșirea recentă a unui terminal primește agentul la o citire; **Mărimea rezultatului unui instrument** o limitează în continuare. **Intervalul verificării actualizărilor** și **Intervalul verificării catalogului de pluginuri** stabilesc cât de des verifică VERA; o modificare salvată pornește noua așteptare fără o verificare imediată. **Păstrarea logurilor** este câte fișiere zilnice de log păstrează VERA. **Rânduri de conversație afișate la început** și **Rânduri de conversație pe încărcare** stabilesc câte dintre cele mai noi mesaje arată o conversație imediat la deschidere și câte mesaje mai vechi adaugă apoi odată, în fundal, până le arată pe toate. **Rânduri pe pagină** este mărimea cu care pornesc listele; o mărime aleasă într-o listă rămâne pentru acea listă.

**Instrumente, programe și web.** **Mărimea rezultatului unui instrument** limitează orice rezultat de instrument primit de model; o mărime sub **Mărimea textului citit** scurtează și citirile. **Fereastra de citire**, **Rezultate grep**, **Rezultate căutare web** și **Mărimea citirii web** sunt și cantitatea folosită când agentul nu cere una, și maximul pe care îl poate cere. Grep sare peste fișierele mai mari decât **Mărimea fișierelor pentru grep**. **Termen pentru procese worker** limitează fiecare căutare de text sau analiză de log; una deja pornită își păstrează termenul. **Mărimea descărcării** apare în aprobarea descărcării și rămâne legată de ea: o modificare ulterioară nu schimbă o descărcare aprobată, iar un fișier mai mare se oprește cu „Download exceeds the size limit.” **Limita de timp a descărcării** limitează transferul; citirea textului unui PDF descărcat își păstrează propriul termen. **Plafonul de timp pentru programe** se aplică programelor de plugin al căror plugin nu stabilește un timp propriu; **Plafonul de timp pentru comenzi shell** limitează orice comandă shell în prim-plan și apare în aprobarea ei. **Programe în fundal pe sesiune** limitează rulările în fundal ale unei conversații; una în plus este refuzată ca ocupat.

## Compactează acum

**Compactează acum** din **Setările avansate** ale unei sesiuni rezumă imediat istoricul anterior, fără să aștepte pragul și chiar cu compactarea automată dezactivată. Este disponibil cât timp sesiunea nu lucrează; o sesiune arhivată sau un workbench doar pentru citire îl refuză. Dialogul arată rezultatul, de exemplu „Istoric rezumat.”

## Linia de comandă

`vera run` acceptă setările de sesiune pentru o rulare: `--advanced toolCallsPerTurn=100`, `--advanced noOutputTimeout=900` sau `--advanced autoCompaction=off`. Un comutator acceptă `on`, `off`, `true` sau `false`. Aceste valori se aplică doar acelei rulări și nu se salvează în sesiune. Repetă opțiunea pentru mai multe setări. O setare necunoscută, o setare care nu este de sesiune sau o valoare în afara intervalului se oprește cu o eroare de utilizare.
