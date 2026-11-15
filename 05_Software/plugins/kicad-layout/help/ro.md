# Plasare PCB și rutare locală KiCad

Plasarea PCB și rutarea locală KiCad îi permite agentului să facă editări controlate pe o placă KiCad 10, pe o copie candidată, prin API-ul IPC oficial al KiCad. Mută, rotește și aliniază footprint-uri și adaugă zone keepout, trasee și via-uri locale. Fiecare cerere este verificată mai întâi (elemente blocate, net-uri, straturi, conturul), apoi candidatul este verificat prin DRC și elemente neconectate și raportat cu previzualizări înainte și după. Placa ta se modifică doar când ceri aplicarea unui candidat care trece verificările. Folderele de rulare ajung în `electronics-results/<run-id>/` din workbench.

## Ce necesită

- **KiCad 10**, pe care îl instalezi singur de la https://www.kicad.org/download/ (pe Ubuntu din PPA-ul KiCad 10). Apoi folosește **Verifică dependențele** pe pagina pluginului.
- API-ul KiCad activat: în KiCad, **Preferences > Plugins**, activează serverul API.
- **kicad-layout-tool**: un script din plugin cu clientul său API, instalat automat de **Instalează dependențele**.
- O singură fereastră KiCad care ține API-ul: închide celelalte ferestre KiCad înainte de a deschide un candidat. Candidatul se deschide în propria fereastră de editor PCB; nu umbla în acea fereastră cât timp lucrează agentul.
- Fără pluginuri necesare și fără parametri de configurare.

## Cum se folosește

- „Deschide un candidat din boards/sensor.kicad_pcb.” (skill-ul `kicad-layout`)
- „Mută C3 lângă pinul VCC al lui U1 și rotește-l cu 90 de grade.”
- „Adaugă un traseu VCC de 0,25 mm de la C3 la U1 și un via GND lângă el.”
- „Păstrează zona de sub antenă liberă de trasee și via-uri.”
- „Arată-mi raportul și previzualizările, apoi aplică candidatul pe placă.”

O cerere refuzată nu modifică nimic. Agentul nu deblochează niciodată singur componente; te întreabă pe tine.

## Risc și aprobări

- Sigur, rulează fără să întrebe: deschiderea, editarea și închiderea unui candidat. Acestea lucrează doar pe copia din folderul rulării și nu scriu niciodată placa ta.
- Blocat: celelalte comenzi `kicad-cli`, pentru că `kicad-cli` rescrie fișiere în folderul de proiect pe care îl citește.
- Aplicarea unui candidat: `apply_candidate` al VERA scrie peste placa sursă un candidat ale cărui obiective au trecut, cu aceeași aprobare ca orice scriere de fișier: refuzată în Doar citire, cerută în modul Întreabă. Este refuzată când sursa sau candidatul s-au schimbat ori cât timp placa este deschisă în KiCad; salvează sau renunță la modificările de acolo și închide-o mai întâi.

## Limitări

- Windows x64 și Linux x64. Ubuntu nativ nu este încă verificat pentru această versiune.
- API-ul KiCad 10 are nevoie de o fereastră de editor PCB; nu există un mod headless.
- DRC-ul KiCad nu dovedește integritatea semnalului, comportamentul RF sau potrivirea termică.
- Fără plasare globală, autorutare, editare de schemă sau înlocuire de footprint-uri. Pentru autorutare, folosește pluginul freerouting.
- Referință: https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/
