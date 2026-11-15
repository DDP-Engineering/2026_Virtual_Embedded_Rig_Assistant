# ESP32 eFuse-uri și securitatea imaginilor

ESP32 eFuse-uri și securitatea imaginilor îi permite agentului să examineze eFuse-urile unui cip Espressif și, numai când ceri explicit, să facă o singură modificare permanentă de eFuse odată. Citește rezumate și valori brute ale eFuse-urilor cu espefuse și pregătește local chei de secure boot, semnături, digest-uri și imagini criptate cu espsecure. Biții eFuse sunt programabili o singură dată: o ardere nu poate fi anulată niciodată și poate distruge definitiv cipul. Activează-l pentru un workbench doar când este nevoie; în pachetul ESP32, grupul său **Security (irreversible)** este dezactivat implicit.

## Ce necesită

- **espefuse** și **espsecure** din pachetul esptool 5 de pe PyPI, instalate automat de **Instalează dependențele** de pe pagina pluginului. La instalare nu se arde nimic.
- O placă din familia ESP32 pe un port serial, pentru citiri și arderi. eFuse-urile virtuale (`--virt`) nu au nevoie de cip.
- Fără pluginuri necesare și fără parametri de configurare.

## Cum se folosește

- „Arată rezumatul eFuse al ESP32-S3 de pe COM5.” (skill-ul `esp32-efuse-review`)
- „Sunt activate secure boot sau criptarea flash pe acest cip?”
- „Explică ce ar face arderea JTAG_DISABLE pe acest ESP32 și scrie un plan pentru asta.”
- „Generează o cheie de semnare pentru secure boot și semnează build/app.bin.”
- „Încearcă mai întâi arderea JTAG_DISABLE pe eFuse-uri virtuale.”

O întrebare despre secure boot, o inspecție sau activarea pluginului nu contează niciodată drept cerere de ardere. Înainte de orice ardere, agentul citește rezumatul curent, explică exact câmpul, valoarea lui actuală și cea dorită și cum o valoare greșită ar putea distruge acest cip și salvează un plan scris ca artefact al sesiunii, pentru ca tu să-l verifici. Nu grupează niciodată mai multe arderi într-o singură comandă, nu reîncearcă niciodată o ardere eșuată și nu adaugă niciodată `--force`. Materialul cheilor private nu ajunge în chat sau în artefacte.

## Risc și aprobări

- Sigur, rulează fără să întrebe: ajutorul și operațiile espsecure pe fișiere locale de chei și imagini. Sigur descrie doar riscul hardware: espsecure poate suprascrie fișiere de ieșire, iar `sign-data` își modifică fișierul de intrare când nu este dată o ieșire.
- Citire dispozitiv: rezumatul, dump-ul, verificările de erori, MAC-ul personalizat și informațiile ADC. Conectarea resetează cipul în bootloader.
- Ireversibil: fiecare comandă `burn-*`, protecția la scriere și la citire și setarea tensiunii flash. În modurile Întreabă și Editare automată, VERA îți cere să tastezi cuvântul comenzii, de exemplu `burn-efuse`. În Bypass aceste comenzi rulează fără să întrebe, așa că folosește Bypass cu grijă când acest plugin este activat.
- Blocat: operațiile espsecure cu un HSM extern.

## Limitări

- Windows x64 și Linux x64.
- Toate arderile testate au folosit eFuse-uri virtuale; nicio ardere fizică nu a fost testată.
- Un cip a cărui schemă de codare cere arderea mai multor câmpuri împreună nu este gestionat; agentul se oprește și explică.
- Referințe: https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/index.html și https://docs.espressif.com/projects/esptool/en/latest/esp32/espsecure/index.html
