# Analiză firmware și planificarea testelor

Skill-urile de analiză îi oferă agentului două proceduri pentru lucrul cu dovezi pe care le-ai capturat deja. Skill-ul `firmware-comparator` compară o rulare de firmware de referință cu una candidată pe baza logurilor, a condițiilor de rulare documentate, a notelor de lansare și a unui criteriu de acceptare și salvează în sesiune un raport de comparație cu surse citate. Skill-ul `test-planner` transformă o modificare de firmware, o defecțiune capturată sau un obiectiv în unul până la cinci cazuri de test manuale, cu pregătire, pași și criterii de acceptare susținute de surse și un tabel de rezultate, și salvează planul în sesiune. Niciunul dintre skill-uri nu programează, nu capturează, nu compilează și nu rulează vreun test.

## Ce necesită

- Niciun program și nicio configurare: pluginul adaugă doar skill-uri.
- Loguri capturate în workbench (de exemplu în `logs/`), note de rulare precum `docs/runs.md` sau `WORKBENCH.md` și documentele cu criteriul și notele de lansare pe care comparația sau planul trebuie să le citeze. Documentele indexate fac notele de lansare căutabile; fără indexare, agentul citește fișierele direct.
- Opțional: pentru a compara două build-uri după dimensiune sau simboluri, ambele foldere de build și un plugin activat cu o comandă sigură de dimensiune sau simboluri, de exemplu esp32-idf (`idf.py size`).

## Cum se folosește

- „Compară logurile de pornire ale firmware-ului 1.0.0 și 1.1.0 pe placa rev B cu criteriul de pornire din docs/boot-test.md.”
- „Care dintre aceste rulări diferă și ce s-a schimbat între ele? Întreabă-mă dacă se potrivesc mai multe rulări.”
- „Planifică cel mult trei teste manuale pentru modificarea de timing I2C din versiunea 1.1.0.”
- „Transformă raportul de comparație într-un plan de test cu un control de referință.”

După redeschiderea conversației, poți cere un plan din ultimul raport de comparație salvat în sesiune.
Pentru un anumit raport, indică referința exactă `artifact:...`. Planul arată starea fiecărui caz.
Dacă pregătirea este documentată, dar lipsește limita de acceptare, cazul spune ce să măsori și
rămâne doar pentru observație.
Citările salvate folosesc referința exactă din cel mai mic interval returnat care acoperă liniile citate.

Când se potrivesc mai multe rulări, agentul îți cere să alegi; nu o alege niciodată în tăcere pe cea mai nouă. Dacă lipsește placa, revizia, pregătirea sau criteriul, raportul sau planul rămâne marcat ca blocat, iar agentul îți cere faptele care lipsesc. O limită numerică pe care nu o declară nicio sursă nu este niciodată inventată.

## Risc și aprobări

Pluginul nu declară reguli și nu rulează programe proprii. Un plan de test poate numi o comandă a altui plugin activat, de exemplu `esptool write-flash` (scriere dispozitiv), dar numai ca pas opțional pe care îl poți cere separat. Comparația opțională de dimensiune folosește doar o comandă sigură a celuilalt plugin, care rulează fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- O comparație stabilește ce arată capturile, nu de ce: note identice nu dovedesc că laboratorul a fost identic, iar comparabilitatea nu înseamnă că versiunea e gata de lansare.
- Un plan este doar o pregătire; rezultatele rămân în așteptare până când furnizezi dovezi măsurate.
