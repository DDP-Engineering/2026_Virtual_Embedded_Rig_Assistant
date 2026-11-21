# Depanare

## Agentul nu răspunde

- Deschide **Setări** → **Furnizori** și selectează **Testează** pe conexiunea folosită de sesiune. Pasul care eșuează îți arată unde să cauți; vezi [Furnizori și modele](providers.md).
- **Nu se poate accesa …**: serverul local nu rulează sau adresa ori rețeaua este greșită.
- **Autentificare eșuată**: introdu din nou cheia sau autentifică-te din nou cu ChatGPT.
- **Limita contextului a fost atinsă**: scurtează intrarea, pornește o sesiune nouă sau corectează fereastra de context a unei conexiuni personalizate.
- O execuție blocată poate fi încheiată oricând cu **Oprește**.

## Workbench-ul este doar pentru citire

Mesajul **Acest workbench este deschis doar pentru citire deoarece alt proces sau o blocare îl deține.** înseamnă că un alt proces VERA are workbench-ul deschis. Închide-l, apoi deschide din nou workbench-ul. Un workbench aflat pe un folder partajat în rețea nu este acceptat; mută-l pe un disc local.

## Agentul nu găsește ceva în documente

1. Deschide fila **Fișiere** și uită-te la starea documentului.
2. **Necesită OCR**: PDF-ul este o scanare fără text. Folosește un PDF cu strat de text.
3. **Eșuat** sau **Neacceptat**: motivul este afișat pe document și în **Proprietăți**. Fișierele vechi `.doc`, `.ppt` și `.xls` nu sunt indexate.
4. Documentul nu este marcat deloc: se află în afara folderelor indexate. Adaugă-i folderul la **Editează workbench-ul** → **Documente și RAG** și verifică dacă nu îl exclude `.vera/.veraignore` sau, cu **Folosește .gitignore** bifat, un fișier `.gitignore`.
5. Selectează **Reindexează**. Dacă indexarea s-a oprit, selectează **Repornește indexarea**.

Vezi [Documente și căutare](documents-and-search.md).

## O citare nu a putut fi verificată

Fișierul citat s-a modificat sau a fost eliminat după răspuns ori agentul a citat ceva ce nu a citit. Cere-i agentului să verifice din nou.

## Agentul nu folosește un plugin

- Este pluginul activat pentru acest workbench? Verifică **Editează workbench-ul** → **Pluginuri**.
- Blocul său **Stare** afișează **Gata**? Dacă nu, selectează **Verifică dependențele**, instalează ce lipsește și completează **Configurare**.
- În modul **Doar citire** rulează doar comenzile sigure; comenzile clasificate **Blocat** nu rulează niciodată. Vezi [Permisiuni](permissions.md).
- **Fără încredere pe această mașină** sau **Fișierele pluginului s-au schimbat după verificare; instalează-l din nou.**: revizuiește și instalează din nou pluginul.
- Un program nu se comportă cum te aștepți: deschide fila **Rulări** și selectează **Deschide jurnalul**.

Vezi [Pluginuri](plugins.md).

## Catalogul de pluginuri nu este afișat

Când catalogul nu poate fi accesat sau semnătura lui nu se potrivește, pagina **Pluginuri** afișează în schimb pluginurile incluse în VERA. Verifică rețeaua și **URL-ul catalogului** la **Setările catalogului** sau folosește **Folosește implicitul**.

## Actualizări

- **Actualizarea este amânată până la încheierea tuturor execuțiilor și aprobărilor.**: finalizează sau oprește sesiunile în curs.
- **Sursa de actualizări nu a putut fi accesată.**: verifică rețeaua, apoi selectează **Verifică acum**.
- Instalările portabile și cele Linux `.deb` nu își instalează singure actualizările; vezi [Setări](settings.md).

## VERA se închide imediat după pornire

VERA nu pornește când fișierul său `settings.json` este deteriorat sau a fost editat manual într-o formă invalidă. Caută cauza în cel mai recent fișier jurnal. Corectează fișierul sau mută-l în altă parte: VERA pornește atunci cu setările implicite, iar tu îți configurezi din nou furnizorii și preferințele.

## Jurnale

VERA scrie câte un fișier jurnal pe zi, `vera-YYYY-MM-DD.log`, în folderul `logs` din folderul său de date și le păstrează pe cele mai noi șapte sau câte sunt setate la **Păstrarea logurilor** în [Setări avansate](advanced-settings.md). Cheile și alte secrete cunoscute sunt eliminate din jurnale. Ieșirea programelor pluginurilor nu se află în aceste jurnale, ci în `.vera/runs/` din workbench.

## Unde își păstrează VERA datele

Datele aplicației se află într-un singur folder:

| Instalare | Folder |
|---|---|
| Windows | `%APPDATA%\VERA\` |
| Linux | `~/.config/VERA/` |
| Portabilă | `data` lângă `vera.exe` |

| Element | Conținut |
|---|---|
| `settings.json` | Preferințe, conexiuni la furnizori fără chei, workbench-uri recente |
| `credentials.json` | Chei și tokenuri de autentificare, criptate acolo unde sistemul permite |
| `logs/` | Fișiere jurnal zilnice |
| `plugins/` | Pluginurile instalate și programele instalate de VERA pentru ele |
| `window-state.json` | Dimensiunea și poziția ferestrei |

Tot ce aparține unui proiect, cum ar fi sesiunile, indexul documentelor, artefactele, descărcările și jurnalele rulărilor, se află în folderul `.vera/` propriu al workbench-ului; vezi [Workbench-uri](workbenches.md).
