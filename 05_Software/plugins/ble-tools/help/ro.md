# Instrumente BLE (descoperire și GATT)

Instrumentele BLE îi permit agentului să caute dispozitive Bluetooth Low Energy pentru un timp limitat și să ruleze operații GATT controlate pe dispozitivele pe care le-ai declarat: să confirme identitatea unui dispozitiv față de profilul lui, să-i listeze serviciile, să citească caracteristicile declarate, să înregistreze notificări și să trimită o scriere cu nume. Un dispozitiv este identificat după adresă, niciodată după nume sau puterea semnalului. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **ble-tool**: un script fixat pe Bleak 3.1.0, instalat automat de **Instalează dependențele** de pe pagina pluginului.
- Un adaptor Bluetooth pe acest computer, pornit: Windows 11 sau Linux cu BlueZ 5.55 sau mai nou.
- `lab/resources.json` în workbench (parametrul `lab-resources`): câte o intrare `ble-device` pentru fiecare dispozitiv, cu aliasul, adresa, profilul și opțional numărul de serie. Secțiunea **Configurare** de pe pagina pluginului arată dacă fișierul este valid.
- Un profil de dispozitiv: un fișier JSON care declară serviciile, caracteristicile, payload-urile, unitățile, limitele, operațiile permise și scrierile cu nume ale dispozitivului. Pluginul include un exemplu.
- Asocierea (pairing), când e necesară, este pasul tău, în setările Bluetooth ale sistemului de operare.

## Cum se folosește

- „Caută dispozitive BLE timp de 10 secunde.” (skill-ul `ble-devices`)
- „Scrie un profil și o intrare în lab/resources.json pentru termometrul de la C4:7F:51:00:12:34.” (skill-ul `ble-profiles`)
- „Identifică dispozitivul thermo față de ble/thermo.json.”
- „Înregistrează notificările de temperatură de la thermo timp de 30 de secunde.”
- „Setează nivelul ventilatorului dispozitivului fan la 40.”

Agentul te întreabă care adresă este dispozitivul; nu alege niciodată una după nume. O conectare, citire sau scriere eșuată nu se reîncearcă.

## Risc și aprobări

- Sigur, rulează fără să întrebe: verificarea offline a unui profil și rapoartele de rulare.
- Citire dispozitiv: scanarea, identificarea, listarea serviciilor și citirea caracteristicilor sau abonarea la ele fără efecte secundare.
- Scriere dispozitiv: citirea unei caracteristici sau abonarea la una pe care profilul o marchează ca modificând starea, trimiterea unei scrieri de configurare sau de acționare (poate schimba o setare sau poate mișca, comuta ori acționa hardware, iar butonul Oprește nu o anulează) și eliberarea unei conexiuni.
- Ireversibil: o scriere persistentă, pe care dispozitivul o stochează și o păstrează după reset. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei comenzi de citire dispozitiv și de scriere dispozitiv; Editare automată rulează comenzile de citire dispozitiv fără să întrebe.

## Limitări

- Windows x64 și Linux x64; Windows 10 nu este suportat. Pe Linux, scanarea trebuie să fie activă (`--active`), iar o scriere cu răspuns este limitată la 20 de octeți.
- Fără asociere, introducerea PIN-ului, scriere brută, actualizare de firmware, advertising, Bluetooth Classic sau modificarea setărilor Bluetooth.
- Sunt verificate doar un backend simulat și o scanare pasivă reală pe Windows 11; operațiile pe dispozitive reale și Linux nu sunt încă dovedite.
- Referință: https://bleak.readthedocs.io/en/latest/
