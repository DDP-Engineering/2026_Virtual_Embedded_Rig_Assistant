# Magistrală CAN (python-can)

Magistrala CAN îi permite agentului să găsească adaptoare CAN, să captureze o magistrală în mod listen-only într-un log ASC, BLF sau candump și să trimită cadre individuale sau să redea un log pe o magistrală activă prin python-can. Interfețele suportate sunt PEAK, Vector, Kvaser, slcan, gs_usb (candleLight) și SocketCAN, plus o magistrală software (`udp_multicast`) pentru repetiții fără hardware. Decodează capturile cu pluginul can-dbc.

## Ce necesită

- **can**: un script pe python-can 4.6.1, instalat automat de **Instalează dependențele** de pe pagina pluginului.
- Un adaptor CAN și driverul producătorului, pe care îl instalezi singur; VERA nu instalează niciodată drivere. `can list` raportează fiecare driver lipsă cu un indiciu: driverul PEAK cu PCAN-Basic, setup-ul driverului Vector și XL Driver Library (Windows), driverele Kvaser și CANlib, WinUSB prin Zadig pentru gs_usb pe Windows.
- Pe Linux, activează singur o legătură SocketCAN, de exemplu listen-only la bitrate-ul corect, sau creează o magistrală virtuală `vcan0`.
- Interfața, canalul și bitrate-ul magistralei tale. Agentul nu ghicește niciodată un bitrate.
- Fără parametri de configurare.

## Cum se folosește

- „Ce interfețe și drivere CAN sunt disponibile?”
- „Capturează 10 secunde de magistrală pe PCAN_USBBUS1 la 500 kbit/s în captures/bus.asc.” (skill-ul `can-capture`)
- „Înregistrează 2000 de cadre de pe can0 în captures/can0.blf, în fundal.”
- „Trimite ID-ul 0x200 cu datele E80301 pe PCAN_USBBUS1 la 500 kbit/s.” (skill-ul `can-transmit`)
- „Redă primele 50 de cadre din captures/startup.asc în timp ce capturezi răspunsul.”

## Risc și aprobări

- Sigur, rulează fără să întrebe: listarea interfețelor și a driverelor.
- Citire dispozitiv: o captură listen-only. Adaptoarele PEAK, Vector, Kvaser și slcan sunt deschise astfel încât să nu confirme niciodată cadre; o legătură SocketCAN contează aici doar dacă ai activat-o în mod listen-only.
- Scriere dispozitiv: o captură cu `--active`, în care adaptorul intră pe magistrală și confirmă cadre; un bitrate greșit poate genera cadre de eroare care deranjează celelalte noduri. Agentul te întreabă înainte să-l adauge.
- Ireversibil: `send` și `replay`, care transmit pe o magistrală activă; ECU-urile receptoare reacționează imediat la cadre. VERA îți cere să tastezi `send` sau `replay` pentru confirmare, cu excepția modului Bypass.

În modul Întreabă, VERA cere aprobarea înaintea fiecărei capturi; Editare automată rulează capturile listen-only fără să întrebe.

## Limitări

- Windows x64 și Linux x64.
- Adaptoarele reale și `vcan0` pe Linux nu sunt încă acoperite de testele VERA; modul listen-only este cerut backend-ului și nu este citit înapoi de la adaptor.
- O captură `.blf` oprită înainte de durata ei poate fi incompletă; `.asc` și `.log` se scriu cadru cu cadru.
- Setările magistralei vin doar din linia de comandă; `~/.canrc`, `can.ini` și variabilele `CAN_*` sunt ignorate.
- Referință: https://python-can.readthedocs.io/en/v4.6.1/
