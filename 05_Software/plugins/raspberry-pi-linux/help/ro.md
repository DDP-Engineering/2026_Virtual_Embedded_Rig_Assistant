# Proiecte Linux pe Raspberry Pi

Acest plugin îi permite agentului să lucreze pe un Raspberry Pi pe care VERA îl accesează prin SSH: trimite un proiect, îi rulează sarcinile și le arată outputul, rulează o comandă, instalează pachete Python și de sistem, administrează servicii care pornesc la boot, citește starea plăcii și aduce fișiere înapoi. VERA se conectează la fel ca `ssh`, cu cheia pe care o folosești deja.

## Ce necesită

- **pi-tool**, un script Python pe care VERA îl instalează singură cu **Instalează dependențele**.
- **Un Raspberry Pi** cu Raspberry Pi OS 12 (Bookworm) pe 64 de biți, cu SSH activat și Python 3.9 sau mai nou.
- **Registrul de laborator** `lab/resources.json` în workbench (obligatoriu), care declară placa drept `linux-board`. Ajung hostul și utilizatorul; agentul scrie intrarea când i le spui.
- **O cheie SSH**: o cheie din agentul SSH sau o cheie privată din `~/.ssh` fără parolă de protecție, a cărei jumătate publică este autorizată pe placă. VERA nu lucrează niciodată cu o parolă.
- **Un manifest de proiect** `vera-pi.json` într-un folder de proiect (opțional): fișierele de trimis, dependențele Python, sarcinile și serviciile.

Secțiunea **Configurare** de pe pagina pluginului arată starea fiecăruia.

## Cum se folosește

Agentul folosește skill-urile `raspberry-pi-projects` și `raspberry-pi-tasks`.

- „Pi-ul meu este raspberrypi.local, utilizatorul pi. Conectează-te și spune-mi în ce stare este.”
- „Rulează proiectul blink pe pi.”
- „Instalează i2c-tools pe pi și scanează magistrala I2C.”
- „Fă ca blink să pornească la boot și arată-mi logurile lui.”

Prima conectare salvează cheia de host a plăcii. Dacă reinstalezi sistemul plăcii, cheia se schimbă, iar VERA o refuză până îi spui agentului să aibă încredere în cea nouă.

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): verificările offline ale manifestului și rapoartele.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): verificarea cheii de host, identitatea și starea plăcii, compararea unui proiect cu placa, starea sarcinilor și a serviciilor, logurile și aducerea unui fișier.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): trimiterea fișierelor (nu se șterge niciunul), rularea unei sarcini sau a unei comenzi, pornirea sau oprirea unui serviciu, acceptarea unei chei de host noi și curățarea făcută de VERA. Codul proiectului și comenzile pot acționa hardware-ul atașat plăcii. **Permite întotdeauna** de pe card lasă o comandă precum `pi-tool run-task` să ruleze fără întrebare în **Editare automată**.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): trimiterea cu `--overwrite`, care înlocuiește fișierele editate pe placă; acele modificări se pierd. În **Bypass — acces complet** aceasta rulează fără să întrebe.

## Limitări

- VERA rulează pe Windows x64 sau Linux x64; alte plăci decât Raspberry Pi nu sunt declarate ca suportate.
- O comandă care are nevoie de `sudo` merge doar acolo unde placa îl permite fără parolă, cum face utilizatorul implicit din Raspberry Pi OS.
- `~/.ssh/config` nu este citit: scrie în registru hostul și utilizatorul reali ai plăcii.
- Pluginul nu a rulat încă pe un Raspberry Pi real.
