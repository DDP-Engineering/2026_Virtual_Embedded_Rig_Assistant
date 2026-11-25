# Wireshark (TShark)

Pentru a compara offline două capturi salvate, indică o referință, un candidat, punctele de observare și ferestrele de timp. Raportul arată diferențele TCP și UDP, timpii DNS și HTTP disponibili, dovezile lipsă și legăturile la cadrele originale. Poți cere salvarea locală a raportului.

Cere agentului să importe un dump hexazecimal firmware sau UART salvat ca PCAPNG. Precizează dacă ai cadre Ethernet complete, date opace sau ai nevoie de antete IPv4/UDP sintetice. Indică dacă dumpul conține ore UTC. Manifestul de proveniență identifică hashul sursei și metadatele sintetice. Importul necesită Text2pcap.

Cere agentului să inspecteze metadatele unei capturi, să selecteze cadre sau să împartă, combine, reordoneze, deduplice, convertească ori curețe capturi salvate. Fișierele originale sunt păstrate. Capturile curățate pot conține în continuare date și identificatori ai pachetelor. Agentul poate exporta local câmpurile, PDU-urile și corpurile HTTP acceptate. Disponibilitatea depinde de utilitarele Wireshark instalate.

Pentru analiza rețelei, întreabă despre Ethernet și VLAN, IPv4 și IPv6, ARP și descoperirea vecinilor, DNS și DHCP, TCP și UDP, multicast sau metadatele TLS vizibile. Cere dovezi compacte pentru a ascunde adresele și numele, păstrând legăturile la cadre și limitele capturii.

Pentru trafic Automotive Ethernet salvat, cere agentului o analiză DoIP, SOME/IP sau Service Discovery. Poate afișa direcția, VLAN-ul, câmpurile PDU și cadrele contributoare. Indică portul serviciului SOME/IP când este necesar.

Instrumentul offline listează conversațiile și endpointurile, măsoară traficul și timpii de răspuns DNS sau HTTP și afișează diagnosticele pe cadre. Deschide un cadru citat în Wireshark Desktop pentru a examina local conținutul fluxului.

Folosește instrumentul offline pentru a selecta câmpuri, a filtra pachete și a cita cadre dintr-o captură verificată. Importă o captură pentru a păstra fișierul verificat în spațiul de lucru.

Acest plugin îi permite agentului să analizeze fișiere de captură de rețea cu TShark și să captureze trafic live de pe o interfață a computerului tău. Răspunde la întrebări despre capturi `.pcap` și `.pcapng` ale traficului Ethernet, Wi-Fi sau USB al unei plăci, cu filtre de afișare, export de câmpuri, statistici de protocol și detalii de pachete, și salvează în workbench capturi live limitate.

## Ce necesită

- **TShark**, pe care îl instalezi singur odată cu Wireshark de la https://www.wireshark.org/download.html (pe Windows include TShark și oferă Npcap) sau pachetul `tshark` al distribuției tale (`sudo apt install tshark` pe Debian și Ubuntu). VERA nu îl descarcă niciodată; secțiunea **Dependențe** de pe pagina pluginului arată dacă a fost găsit.
- Pentru capturi live: Npcap pe Windows sau permisiuni de captură dumpcap pe Linux (instalează `wireshark-common`, permite captura fără root, intră în grupul `wireshark` și autentifică-te din nou). VERA îți lasă aceste etape ție.
- Fără alte pluginuri și fără configurare.

## Cum se folosește

Agentul folosește skill-urile `wireshark-analyze` și `wireshark-capture`. Citește întotdeauna fișierele cu `-r` și păstrează adresele numerice, așa că nicio rezolvare de nume nu ajunge în rețea. Pentru o captură live listează interfețele și te lasă să confirmi care dintre ele transportă traficul plăcii.

- „Dă-mi o privire de ansamblu asupra protocoalelor din captures/board.pcapng.”
- „Listează fiecare cerere CoAP din captură cu timpul și calea URI.”
- „Arată problemele TCP raportate de analiza expert, cu numerele cadrelor.”
- „Decodează portul UDP 5684 ca CoAP și exportă codurile.”
- „Capturează 30 de secunde de trafic către și dinspre 192.168.7.10 pe interfața 3 în captures/board.pcapng.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): citirea unei capturi salvate cu orice filtru, câmp, statistică sau opțiune de ieșire, ajutorul, versiunea și listarea interfețelor.
- **Citire dispozitiv** (întreabă în modul **Întreabă**, rulează singur în **Editare automată**): o captură live și orice comandă care scrie un fișier sau un dosar (`-w`, `--export-objects`, `--export-tls-session-keys`, `--log-file`), de exemplu o copie filtrată a unei capturi. O comandă fără `-r` capturează și ea live, pe prima interfață.
- **Scriere dispozitiv** (întreabă în **Întreabă** și **Editare automată**): o opțiune pe care acest plugin nu o recunoaște.
- **Blocat**: scripturile Lua, care pot rula cod arbitrar, și parolele RPCAP în linia de comandă, care ar fi stocate în logurile rulărilor.

## Limitări

- Windows x64 și Linux x64. Regulile au fost măsurate cu TShark 4.6.8.
- Analiza offline folosește un profil Wireshark izolat. Rulările TShark generice încarcă profilul tău Wireshark și extensiile lui.
- Interfețele la distanță și extcap (sshdump, `rpcap://`) capturează pe alte gazde. Configurează captura la distanță și credențialele ei în afara VERA.
