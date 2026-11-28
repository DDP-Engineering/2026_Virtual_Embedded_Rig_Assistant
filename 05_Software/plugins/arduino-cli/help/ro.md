# Arduino CLI

Arduino CLI compilează și încarcă sketch-uri Arduino native (proiecte `.ino`) cu un arduino-cli fixat, fără Arduino IDE. Agentul instalează core-uri și biblioteci, compilează un sketch, încarcă build-ul pe placa ta și citește ce afișează placa, într-un singur pas când îi ceri. Totul rulează în mediul Arduino propriu al VERA (`~/.vera-arduino`, `%USERPROFILE%\.vera-arduino` pe Windows); folderele Arduino IDE nu sunt citite sau modificate niciodată. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **arduino-cli** 1.6.0: pe pagina pluginului, **Instalează dependențele** îl descarcă și îi verifică SHA-256. Un arduino-cli 1.6 sau mai nou (sub 2) instalat de tine de la https://arduino.github.io/arduino-cli/latest/installation/ este găsit în PATH; descărcarea fixată are prioritate.
- **arduino-tool**: un script din plugin, instalat automat.
- Pluginul **serial-monitor**, pentru a urmări mai mult timp consola plăcii. **Instalează cu dependențe** îl adaugă.
- O placă Arduino conectată prin USB. Pe Linux, utilizatorul tău trebuie să fie în grupul care deține porturile seriale (`dialout` pe Debian, Ubuntu și Fedora).
- Niciun parametru de configurare.

## Cum se folosește

- „Compilează sketch-ul Blink pentru un Arduino Uno și raportează memoria flash și RAM folosită.” (skill-ul `arduino-build-fix`)
- „Compilarea spune că lipsește Adafruit_BME280.h. Instalează biblioteca potrivită.” (skill-ul `arduino-libraries`)
- „Scrie un sketch mic care afișează citirile BME280, încarcă-l și arată-mi ce afișează.” (skill-ul `arduino-test-sketch`)
- „Ține minte că acest sketch este pentru placa Nano de pe COM7.”
- „Ce plăci sunt conectate?”
- „Pornește de la sketch-ul exemplu al bibliotecii BME280.”
- „Sketch-ul nu mai încape pe Uno. Ce ocupă cel mai mult flash?”

Agentul găsește singur placa și portul atunci când se potrivește doar una și te întreabă când sunt conectate mai multe. O placă aflată în spatele unui cip convertor USB (CH340, FTDI, CP210x) nu se poate identifica singură, așa că spune-i agentului ce placă este; încărcarea rulează atunci cu mențiunea că modelul nu a fost verificat.

## Risc și aprobări

- Sigur, rulează fără să întrebe: inspectarea unui sketch, listarea plăcilor și a exemplelor de biblioteci, căutările de plăci, core-uri și biblioteci, compilarea (care rulează compilatorul și hook-urile de build ale core-ului pe acest computer), rapoartele de rulare și curățarea folderelor de build ale VERA.
- Citire dispozitiv: instalarea de core-uri, biblioteci și indexuri, care descarcă în mediul Arduino al VERA, memorarea plăcii și a portului unui sketch în `sketch.yaml`, copierea unui exemplu de bibliotecă în workbench ca sketch nou și ștergerea folderelor vechi de rulare.
- Scriere dispozitiv: încărcarea, prin USB sau prin rețea, și ca parte a unei compilări, care scrie memoria flash a plăcii și pornește imediat noul firmware; și orice altă comandă arduino-cli pe care agentul o transmite cu `arduino-tool cli`.
- Ireversibil: încărcarea cu `--programmer` sau scrierea unui bootloader, care suprascrie bootloaderul. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.
- Blocat: orice comandă `arduino-cli` directă.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei comenzi de citire și de scriere dispozitiv; Editare automată rulează comenzile de citire dispozitiv fără să întrebe.

## Limitări

- Windows x64 și Linux x64. Încărcarea și citirea portului serial nu au fost încă rulate pe o placă reală.
- Nici încărcarea prin rețea (OTA) nu a fost încă rulată pe o placă reală.
- Comenzile care așteaptă date de la tastatură, cum sunt monitorul și depanatorul interactiv ale arduino-cli, și daemonul lui nu sunt rulate.
- Profilurile dintr-un `sketch.yaml` nu sunt folosite; placa și portul lui implicite sunt.
