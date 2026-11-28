# Wireshark Dumpcap

Activează pluginul opțional și instalează Dumpcap 4.2 sau o versiune ulterioară. Windows necesită Npcap. Pe Linux ai nevoie de permisiune de captură pe interfața aleasă.

Cere-i lui VERA să captureze ce trimite și primește o placă pe o interfață de rețea a acestui computer. Ea listează interfețele și poate număra, timp de câteva secunde, pachetele văzute de fiecare, ca să o găsească pe cea la care e legată placa. Numește interfața; filtrul de captură, durata (implicit 30 de secunde, cel mult o oră) și limita de mărime sunt opționale. O captură mai lungă de un minut rulează în fundal, așa că îi poți cere să o pornească, să ruleze un test sau să repornească placa și apoi să o oprească. Pentru un eveniment rar, cere o captură rotativă care păstrează cele mai noi segmente. Rezultatul arată ce s-a păstrat și ce s-a pierdut. Activează Wireshark TShark pentru a inspecta o captură păstrată.

O captură este o citire de dispozitiv: VERA te întreabă în modul Întreabă și o rulează singură în Editare automată și Bypass. Interfețele USB și cele de sniffer, la care Wireshark ajunge prin extcap, se capturează cu TShark.
