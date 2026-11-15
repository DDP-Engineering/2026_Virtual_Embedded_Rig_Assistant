# ESP32 esptool

ESP32 esptool îi permite agentului să identifice, să programeze, să verifice, să șteargă și să citească cipuri Espressif printr-un port serial, cu esptool v5. Citește imaginile și offset-urile unui build ESP-IDF, le scrie pe cip, verifică dacă fiecare imagine a fost validată și capturează logul de pornire care urmează.

## Ce necesită

- **esptool** 5 de pe PyPI, instalat automat de **Instalează dependențele** de pe pagina pluginului.
- Pluginul **serial-monitor**, care găsește portul plăcii și îi capturează logul de pornire. **Instalează cu dependențe** îl adaugă.
- O placă din familia ESP32 pe un port serial. Pe Linux, utilizatorul tău trebuie să facă parte din grupul care deține porturile seriale: `dialout` (Debian, Ubuntu, Fedora) sau `uucp` (Arch).
- Fără parametri de configurare.

## Cum se folosește

- „Ce cip este pe COM5?” (skill-ul `esp32-flash`)
- „Programează build-ul ESP-IDF din build/ pe ESP32-S3 de pe COM5, verifică-l și arată-mi logul de pornire.”
- „Verifică dacă placa de pe COM5 are încă acest build.”
- „Fă o copie de rezervă a întregului flash al ESP32 de pe COM5 în backup.bin.”
- „Șterge flash-ul plăcii de pe COM5.”

Agentul găsește portul cu monitorul serial și nu îl ghicește niciodată. Confirmă mai întâi tipul cipului și apoi îl transmite fiecărei comenzi, astfel încât o placă greșită duce la eșec în loc să fie scrisă. Folosește exact offset-urile din `build/flasher_args.json`. Dacă build-ul activează secure boot sau criptarea flash, se oprește și te întreabă înainte de programare, pentru că un astfel de bootloader arde eFuse-uri la prima pornire. Înainte de ștergere, te anunță că se șterg și datele NVS și credențialele Wi-Fi.

## Risc și aprobări

- Sigur, rulează fără să întrebe: comenzile care lucrează doar cu fișiere (`merge-bin`, `image-info`, `elf2image`).
- Citire dispozitiv: identificarea cipului, citirea MAC-ului, a ID-ului flash și a stării de securitate, verificarea și citirea flash-ului. Fiecare comandă care se conectează resetează cipul în bootloader și oprește firmware-ul care rulează.
- Scriere dispozitiv: `write-flash`, `erase-flash`, `erase-region` și `load-ram`. Cardul de aprobare listează fiecare imagine cu SHA-256 al ei; dacă o imagine este recompilată după ce ai aprobat, rularea eșuează și aprobarea este cerută din nou.
- Ireversibil: `write-mem`, `write-flash-status` și orice comandă cu `--force`. Acestea pot seta definitiv biți eFuse sau biți de blocare a flash-ului ori pot face ca un cip securizat să nu mai pornească. Agentul le folosește doar când ceri exact acea comandă, iar VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei comenzi de citire dispozitiv și de scriere dispozitiv; Editare automată rulează comenzile de citire dispozitiv fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- Când cipul nu intră în bootloader, poate fi nevoie să ții apăsat BOOT, să apeși RESET și apoi să eliberezi BOOT.
- Referință: https://docs.espressif.com/projects/esptool/en/latest/
