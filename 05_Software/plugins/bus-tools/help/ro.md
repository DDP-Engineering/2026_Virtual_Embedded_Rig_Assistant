# Instrumente de magistrală (I2C, SPI, UART)

Instrumentele de magistrală îi permit agentului să ruleze tranzacții I2C, SPI și UART limitate pe circuitul tău, printr-un Bus Pirate 5 sau 6 în modul binar BPIO2. Identifică adaptorul, configurează o magistrală dintr-un profil, citește un registru declarat, rulează un transfer limitat sau înregistrează un UART, apoi lasă o stare finală declarată și o citește înapoi: implicit HiZ, cu rezistențele pull-up și alimentarea oprite. Captura pasivă și decodarea rămân la pluginul sigrok. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **bus-tool**: un script instalat de **Instalează dependențele** de pe pagina pluginului.
- Un Bus Pirate 5 sau 6, trecut o dată în BPIO2 cu comanda de terminal `binmode`.
- `lab/resources.json` în workbench (parametrul `lab-resources`): o intrare `bus-adapter` cu aliasul, ambele porturi seriale (tu alegi care este cel binar), identitatea USB și limite de alimentare opționale. Secțiunea **Configurare** de pe pagina pluginului arată dacă fișierul este valid.
- Un profil de magistrală în workbench: cablaj, tensiune logică, alimentare, setările magistralei, limite, stare finală, dispozitive și registre. Pluginul include exemple (BME280, flash W25Q, consolă UART).

## Cum se folosește

- „Identifică Bus Pirate-ul bp.” (skill-ul `bus-transactions`)
- „Scrie un profil de magistrală pentru BME280 la adresa 0x76, logică de 3,3 V, alimentare externă.” (skill-ul `bus-profiles`)
- „Citește registrul chip_id al BME280 și verifică-l față de valoarea așteptată.”
- „Citește 16 octeți din EEPROM începând de la 0x0010.”
- „Înregistrează consola UART timp de 10 secunde după ce trimiți un carriage return.”

Nimic nu se reîncearcă: un NACK, un răspuns lipsă sau o valoare neașteptată încheie rularea. Nu există scanare de adrese; adresele vin din datasheet sau din schemă.

## Risc și aprobări

- Sigur, rulează fără să întrebe: listarea porturilor seriale, descrierea unui profil și rapoartele de rulare.
- Citire dispozitiv: identificarea adaptorului (o singură cerere de stare; pinii, pull-up-urile și alimentarea nu se schimbă).
- Scriere dispozitiv: configurarea magistralei, citirile de registre (care scriu mai întâi adresa registrului și pot șterge flag-uri), transferurile, captura UART și eliberarea, pentru că fiecare comandă pinii adaptorului conectați la circuitul tău.
- Ireversibil: orice apel cu `--power`, care pornește alimentarea adaptorului și alimentează circuitul conectat la el. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.

În modurile Întreabă și Editare automată, VERA cere aprobarea înaintea fiecărei comenzi de scriere dispozitiv.

## Limitări

- Windows x64 și Linux x64. Verificat doar cu un adaptor simulat; încă fără hardware real.
- Fără acces la terminal și fără modificarea firmware-ului sau a setărilor adaptorului. Alte adaptoare (Bus Pirate v3/v4, FT232H, CH341, Aardvark) nu sunt suportate.
- După o stare finală neconfirmată, VERA refuză operațiile pe magistrală până când o eliberare o confirmă.
- Referință: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
