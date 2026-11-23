# Pluginuri

Pluginurile îi permit agentului să controleze instrumentele de pe bancul tău de lucru: instrumente de programare flash și de depanare, monitoare seriale, analizoare de magistrală, simulatoare, instrumente de măsură. Un plugin își declară programele, modul în care VERA le instalează, nivelul de risc al fiecărei comenzi și skill-urile care îl învață pe agent să le folosească. Fiecare plugin instalat are propria pagină de ajutor în Ajutor și pe cardul său.

## Găsește și instalează un plugin

1. Pe pagina **Pluginuri**, selectează **Explorează pluginurile disponibile**. Filtrează după **Ecosistem**, **Activitate**, **Proveniență**, **Maturitate** sau stare ori caută.
2. Deschide **Detalii** pentru a vedea de ce are nevoie pluginul, inclusiv pluginurile și programele necesare.
3. Selectează **Instalează** sau **Instalează cu dependențe** pentru a instala și pluginurile necesare și programele pe care VERA le poate instala singur.
4. Verifică revizuirea și confirmă.

Un card te avertizează când pluginul nu este disponibil pentru platforma ta sau când poate scrie pe un dispozitiv ori îl poate modifica permanent. Versiunile sub 1.0.0 sunt marcate **Pre-lansare**.

## Instalează un pachet

**Instalează un pachet** instalează pluginurile unui ecosistem, cum ar fi ESP32, STM32 sau Electronics design. Bifează grupurile de care ai nevoie, selectează **Revizuiește pachetul**, apoi **Instalează cu dependențe**. Pluginurile deja instalate sau indisponibile pentru platforma ta sunt omise.

## Revizuire și încredere

Înainte de instalare, VERA afișează o revizuire: ce conține pluginul (**Programe** și proveniența lor, **Skill-uri**, **Profiluri și fișiere de date**, **Documente**) și **Operații**, regulile de comandă ale pluginului grupate după nivelul de risc. Actualizările care schimbă programe, surse sau reguli sunt revizuite din nou. Dacă fișierele pluginului se modifică după instalare, VERA nu îl mai folosește până când nu îl instalezi din nou.

Pluginurile au un nivel de încredere:

| Nivel | Origine |
|---|---|
| **Oficial** | Din catalog, marcat acolo ca oficial |
| **Comunitate** | Orice alt plugin din catalog |
| **Local** | Instalat de tine cu **Instalează din folder…** sau **Instalează din zip…** |
| **Probă** | Creat de agent într-o sesiune; fiecare comandă cere aprobare, inclusiv în Bypass. **Promovează ca local** îi acordă încredere |

Un workbench poate conține și pachete de pluginuri în `.vera/plugins/`. Acestea sunt folosite doar după ce selectezi **Revizuiește pluginul workbench** și **Acordă încredere pachetului**; încrederea este stocată doar pe acest calculator, iar orice modificare a pachetului necesită o nouă revizuire.

## Activează un plugin pentru un workbench

Instalarea nu activează un plugin. Deschide **Editează workbench-ul** → **Pluginuri**, bifează pluginul și selectează **Salvează**. Doar pluginurile activate îi sunt oferite agentului în acel workbench.

## Instrumente și capabilități ale plugin-urilor

**Instrumente** conține capabilitățile VERA generale, inclusiv `run_program`, `run_command`, `program_output`, `program_stop` și accesul la terminal. Programele plugin-urilor, inclusiv integrarea dedicată Git, apar lângă plugin în **Pluginuri**. Execuția necesită în continuare permisiunea instrumentului general, regulile de risc ale comenzilor și permisiunile sesiunii.

**Instrumente permise** de pe card controlează capabilitățile specializate, separat de bifarea plugin-ului. Calculele electrice și catalogul industrial necesită plugin-ul furnizor indicat. `apply_candidate` necesită `kicad-layout` oficial; `parts_search` necesită `parts-search` oficial, acces web și un furnizor activat în secțiunea Configurare a plugin-ului pe pagina Pluginuri. Starea dependenței distinge un plugin dezactivat, lipsă, imposibil de încărcat sau neoficial de o dependență activată; activarea nu garantează programele externe, datele de autentificare ale furnizorului sau permisiunile sesiunii. Verifică dependențele programelor în **Configurează**.

**Instrumente comune electrice / automatizări** apare când este instalat un pachet electric sau de automatizări. Activează un plugin care poate fi încărcat pentru a folosi instrumentele. Instrumentele specifice apar pe cardurile pluginurilor instalate. Permisiunile workbench-ului se păstrează după dezinstalare. Pentru o listă de pluginuri instalate goală, deschide catalogul din **Explorează pluginurile disponibile**.

Permiterea unui instrument nu instalează și nu activează un plugin. Activarea unui plugin nu elimină restricțiile explicite. Ambele liste sunt ciorne până la **Salvează**; **Anulează** le abandonează pe ambele. Restricțiile rămân la redeschidere, iar sesiunile doar pentru citire ascund în continuare instrumentele de scriere și execuție. Folosește Tab pentru bifări și Spațiu pentru comutare; Enter sau Spațiu deschide grupurile.

## Dependențe

Blocul **Stare** al unui plugin instalat verifică două lucruri: **Dependențe** și **Configurare**. Afișează **Gata** doar când ambele sunt pregătite.

- **Verifică dependențele** caută programele; **Verifică toate dependențele** face acest lucru pentru fiecare plugin.
- **Instalează dependențele** instalează ce poate instala VERA singur (pachete Python, scripturi și descărcări cu versiune fixată) în propriul folder de programe. Fiecare descărcare este verificată după SHA-256.
- Programele producătorilor, cum ar fi KiCad, LTspice sau STM32CubeProgrammer, sunt **Administrat extern**: instalează-le cu **Ghid de instalare**, apoi verifică din nou.
- **Reinstalează** descarcă din nou copiile de programe ale VERA și le înlocuiește.
- **Instalează din arhiva dependenței…** instalează un program dintr-o arhivă pe care ai descărcat-o tu; VERA o verifică după SHA-256 din plugin.

## Parametri

Unele pluginuri au nevoie de setări, marcate **Necesită configurare** și introduse în secțiunea lor **Configurare**: de exemplu datele de autentificare pentru brokerul MQTT, tokenuri Wokwi, chei ale distribuitorilor pentru căutarea de componente sau un fișier din workbench, cum ar fi o listă cu resursele bancului de lucru. Secretele ajung doar la o rulare aprobată a acelui plugin; agentul nu le vede niciodată.

## Rulări de programe

Fiecare comandă rulată de agent trece prin modul tău de permisiuni (vezi [Permisiuni](permissions.md)). Fila **Rulări** din panoul din dreapta listează rulările workbench-ului; **Deschide jurnalul** afișează ieșirea, iar **Oprește** încheie un program în curs. Jurnalele sunt păstrate în `.vera/runs/`.

## Actualizări și catalogul

**Caută actualizări** caută versiuni noi ale pluginurilor; o actualizare afișează **Actualizează la …**. VERA verifică și o dată pe zi sau la **Intervalul verificării catalogului de pluginuri** din [Setări avansate](advanced-settings.md), cu excepția cazului în care actualizările sunt dezactivate în [Setări](settings.md). La **Setările catalogului** alegi **Canal** (**Stabil** sau **Pre-lansare**) și, opțional, **URL-ul catalogului**, de exemplu oglinda companiei tale. VERA folosește un catalog doar când semnătura lui se potrivește; altfel afișează pluginurile incluse în VERA.

**Dezinstalează** și **Exportă zip** se află la **Mai multe acțiuni** pe cardul unui plugin instalat. Fără rețea, vezi [Instalare offline](offline-install.md).
