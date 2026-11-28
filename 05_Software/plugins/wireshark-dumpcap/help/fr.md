# Wireshark Dumpcap

Activez cette extension facultative et installez Dumpcap 4.2 ou une version ultérieure. Windows exige Npcap. Sous Linux, l’interface choisie nécessite des droits de capture.

Demandez à VERA de capturer ce qu’une carte envoie et reçoit sur une interface réseau de cet ordinateur. Elle liste les interfaces et peut compter pendant quelques secondes les paquets que chacune voit, pour trouver celle de la carte. Nommez l’interface ; le filtre de capture, la durée (30 secondes par défaut, une heure au plus) et la limite de taille sont facultatifs. Une capture de plus d’une minute s’exécute en arrière-plan : VERA peut la démarrer, lancer un test ou redémarrer la carte, puis l’arrêter. Pour un événement rare, demandez une capture rotative qui garde les segments les plus récents. Le résultat indique ce qui a été conservé et ce qui a été perdu. Activez Wireshark TShark pour examiner une capture conservée.

Une capture est une lecture d’appareil : VERA vous demande en mode Demander et l’exécute directement en modes Modification auto et Contournement. Les interfaces USB et de sniffer que Wireshark atteint par extcap se capturent avec TShark.
