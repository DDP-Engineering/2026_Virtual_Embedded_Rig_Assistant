# Autorouter Freerouting (local)

Autorouterul Freerouting îi permite agentului să ruteze automat, pe acest computer, un candidat de placă KiCad 10 cu Freerouting 2.5.0. Exportă un Specctra DSN din candidatul salvat al unei rulări kicad-layout, îl rutează offline cu un buget finit de treceri și de timp, păstrând cuprul existent și cel blocat, și transformă noile trasee și via-uri într-o cerere kicad-layout. kicad-layout aplică apoi acea cerere pe candidat și o verifică prin DRC. Freerouting rulează cu funcțiile online dezactivate, iar placa sursă se modifică doar când aprobi aplicarea unui candidat care trece verificările.

## Ce necesită

- **Freerouting** 2.5.0 și un runtime Java Eclipse Temurin 25: **Instalează dependențele** de pe pagina pluginului le descarcă pe amândouă și le verifică SHA-256. Nu trebuie să ai Java instalat.
- **freerouting-tool**: un script din plugin, instalat automat.
- **KiCad 10**, pe care îl instalezi singur de la https://www.kicad.org/download/ (pe Ubuntu din PPA-ul KiCad 10); apoi folosește **Verifică dependențele**. VERA nu instalează niciodată KiCad.
- Pluginul **kicad-layout**, care deschide candidatul și aplică rutele. **Instalează cu dependențe** îl adaugă.
- O placă cu componentele plasate: Freerouting doar rutează.
- Fără parametri de configurare.

## Cum se folosește

- „Deschide un candidat din boards/sensor.kicad_pcb și rutează-l automat.” (skill-ul `freerouting`)
- „Rutează doar net-urile VIN și GND pe candidatul deschis.”
- „Rutează din nou cu un buget de 20 de minute.”
- „Aplică rutele, rulează DRC și arată-mi raportul și previzualizările.”
- „Aplică candidatul pe placa sursă.”

Agentul raportează câte conexiuni au rămas nerutate; DRC-ul și numărul de conexiuni neconectate vin de la KiCad, nu de la Freerouting. Freerouting nu este un optimizator: rezultatul lui este o rutare, nu cea mai bună. Conexiunile rămase pot fi rutate manual cu kicad-layout sau după mutarea componentelor.

## Risc și aprobări

- Sigur, rulează fără să întrebe: `freerouting-tool route`, care lucrează pe o copie a candidatului și scrie doar în folderul rulării, plus versiunea sau ajutorul KiCad.
- Blocat: rularea directă a Java, a arhivei Freerouting sau a altor comenzi `kicad-cli`, pentru că `kicad-cli` rescrie fișiere în folderul de proiect pe care îl citește.

Aplicarea rutelor pe candidat și aplicarea candidatului pe placa sursă sunt pași kicad-layout; scrierea plăcii sursă așteaptă aprobarea ta.

## Limitări

- Windows x64 și Linux x64.
- Un proiect cu reguli DRC personalizate (`.kicad_dru`) este refuzat, cu excepția cazului în care accepți rutarea fără ele; Freerouting nu le poate respecta, iar DRC-ul de după editare le verifică în continuare.
- Când bugetul de timp se epuizează, Freerouting este oprit și nu se scrie nicio cerere.
- Freerouting rulează cu verificarea versiunii, analytics, interfața grafică și serverele lui dezactivate; VERA nu îi blochează altfel accesul la rețea.
- Referință: https://github.com/freerouting/freerouting
