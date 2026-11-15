# Proiecte Linux pe Raspberry Pi

Acest plugin îi permite agentului să implementeze proiecte, să ruleze sarcini finite și să administreze servicii de utilizator pe un Raspberry Pi pe care VERA îl accesează prin SSH. Fiecare conexiune verifică cheia de host fixată a plăcii, identitatea, utilizatorul și folderul rădăcină la distanță. Un helper mic de pe placă aplică doar fișierele aprobate, rulează sarcinile declarate cu un buget de timp și pornește, oprește și citește serviciile de utilizator listate. Nu există acces la shell, sudo, servicii de sistem, GPIO brut, I2C sau SPI și nici repornire.

## Ce necesită

- **pi-tool**, un script Python pe care VERA îl instalează singură cu **Instalează dependențele**.
- **Un Raspberry Pi** cu Raspberry Pi OS 12 (Bookworm) pe 64 de biți, un utilizator neprivilegiat cu un manager de utilizator systemd și Python 3.9 sau mai nou.
- **Registrul de laborator** `lab/resources.json` în workbench (obligatoriu), care declară placa ca `linux-board`: host, utilizator, amprentele fixate ale cheii de host, cheia din agent, numărul de serie sau machine id și folderul rădăcină la distanță.
- **Un manifest de proiect** `vera-pi.json` într-un folder de proiect (opțional): fișierele de implementat, sarcinile și serviciile de utilizator.
- **Agentul SSH al sistemului**, care deține cheia ta de autentificare (pe Windows, OpenSSH Authentication Agent sau Pageant). VERA nu lucrează niciodată cu o parolă sau cu un fișier de cheie.

Secțiunea **Configurare** de pe pagina pluginului arată starea fiecăruia.

## Cum se folosește

Agentul folosește skill-urile `raspberry-pi-projects` și `raspberry-pi-tasks`. Compară cheia de host pe consola proprie a plăcii înainte de a o fixa.

- „Verifică cheia de host a plăcii pi, apoi instalează helperul și identifică placa.”
- „Pregătește blink/vera-pi.json pe pi și arată-mi ce fișiere se schimbă.”
- „Rulează sarcina selftest din blink-demo pe pi.”
- „Pornește blink-demo.service și colectează-i logurile.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): verificările offline ale manifestului și rapoartele.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): verificarea cheii de host, identificarea plăcii, starea și logurile sarcinilor și serviciilor.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): instalarea helperului, pregătirea și aplicarea fișierelor (nu se șterge niciunul), rularea unei sarcini, pornirea sau oprirea unui serviciu și curățarea făcută de VERA. Codul proiectului poate acționa hardware-ul atașat plăcii.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): aplicarea cu `--overwrite`, care înlocuiește fișierele editate pe placă; acele modificări se pierd. În **Bypass — acces complet** aceasta rulează fără să întrebe.

## Limitări

- VERA rulează pe Windows x64 sau Linux x64; alte plăci nu sunt declarate ca suportate.
- O cheie de host schimbată este refuzată, niciodată acceptată.
- Un serviciu care continuă să ruleze după sesiune are nevoie de `loginctl enable-linger <user>` pe placă, comandă pe care VERA nu o rulează niciodată.
- Pluginul nu a rulat încă pe un Raspberry Pi real.
