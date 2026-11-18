# Instrumente de laborator SCPI

Acest plugin îi permite agentului să lucreze cu instrumentele de laborator pe care le declară workbenchul tău: un multimetru, un osciloscop sau o sursă de alimentare, prin PyVISA. Identifică un instrument, citește valori cu unități, capturează forme de undă, modifică setări și alimentează o placă de la o ieșire a sursei pentru o menținere limitată. Fiecare comandă provine dintr-un profil al pachetului; nu există SCPI brut și nici căutare în rețea. Fiecare instrument este rezervat pe durata rulării, iar ieșirile lui sunt oprite după apăsarea butonului Oprește, un timeout sau un crash, altfel starea este raportată ca necunoscută. Rezultatele ajung în `embedded-lab-results/`.

## Ce necesită

- **scpi**, un script Python cu PyVISA 1.16.2 și pyvisa-py 0.8.1 fixate, pe care VERA îl instalează singură cu **Instalează dependențele**.
- **Registrul de laborator** `lab/resources.json` în workbench (obligatoriu). Fiecare intrare are un alias, resursa VISA, numărul de serie, profilul și limitele de laborator. Secțiunea **Configurare** de pe pagina pluginului arată dacă fișierul este prezent și valid.
- **Instrumente suportate**: Keysight 34460A/34461A, Rigol DS1054Z/DS1074Z/DS1104Z (și Plus), Rigol DP832/DP832A, prin TCPIP, USBTMC sau (DP800) serial.
- Pentru USBTMC: libusb 1.0 și acces la dispozitiv, pe care le configurezi singur (pe Ubuntu `libusb-1.0-0` și o regulă udev; pe Windows un driver WinUSB, de exemplu cu Zadig). Opțional, o bibliotecă VISA a producătorului (NI-VISA, Keysight IO Libraries).

## Cum se folosește

Agentul folosește skill-urile `bench-instruments` și `instrument-profiles`.

- „Identifică sursa de alimentare psu și arată-i limitele.”
- „Citește tensiunea DC pe multimetrul dmm, domeniul 10 V.”
- „Capturează CHAN1 de pe osciloscop cu 1 ms/div și 0,5 V/div.”
- „Alimentează placa de la psu CH1 la 3,3 V, 0,2 A timp de 10 minute cât timp o programezi.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): informațiile despre profil și registru și recalcularea unei capturi; nu se deschide niciun instrument.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): listarea porturilor seriale și a dispozitivelor USB locale, identify, read, status și capture (care setează doar transferul formei de undă, nu achiziția).
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): modificarea setărilor și oprirea tuturor ieșirilor (inclusiv curățarea făcută de VERA).
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare `output`): alimentarea unei ieșiri a sursei pe durata menținerii; după aceea este oprită și citită înapoi. În **Bypass — acces complet** aceasta rulează fără să întrebe.

## Limitări

- Windows x64 și Linux x64. Niciun profil nu a fost încă verificat pe un instrument real, așa că un rezultat care a modificat setări sau a alimentat o ieșire poartă avertismentul `profile-unverified`; Ubuntu nativ și VISA de la producător nu au fost rulate.
- Un instrument a cărui identitate nu corespunde niciunui profil primește doar identify.
- VERA nu poate bloca alte programe și nimic nu poate opri o ieșire dacă se pierde întregul computer sau VERA.
