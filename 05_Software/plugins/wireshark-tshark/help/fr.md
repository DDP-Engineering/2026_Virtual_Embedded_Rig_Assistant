# Wireshark (TShark)

Ce plugin permet à l’agent d’analyser des fichiers de capture réseau avec TShark et de capturer du trafic en direct sur une interface de votre ordinateur. Il répond aux questions sur des captures `.pcap` et `.pcapng` du trafic Ethernet, Wi-Fi ou USB d’une carte à l’aide de filtres d’affichage, d’exports de champs, de statistiques de protocoles et du détail des paquets, et enregistre des captures en direct limitées dans le banc de travail.

## Prérequis

- **TShark**, que vous installez vous-même avec Wireshark depuis https://www.wireshark.org/download.html (sous Windows, il inclut TShark et propose Npcap), ou le paquet `tshark` de votre distribution (`sudo apt install tshark` sous Debian et Ubuntu). VERA ne le télécharge jamais ; la section **Dépendances** de la page du plugin indique s’il a été trouvé.
- Pour les captures en direct : Npcap sous Windows, ou les autorisations de capture de dumpcap sous Linux (installez `wireshark-common`, autorisez la capture sans root, rejoignez le groupe `wireshark` et reconnectez-vous). VERA vous laisse ces étapes.
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `wireshark-analyze` et `wireshark-capture`. Il lit toujours les fichiers avec `-r` et garde les adresses sous forme numérique, de sorte qu’aucune résolution de nom n’atteint le réseau. Pour une capture en direct, il liste les interfaces et vous laisse confirmer laquelle transporte le trafic de la carte.

- « Donnez-moi une vue d’ensemble des protocoles de captures/board.pcapng. »
- « Listez chaque requête CoAP de la capture avec son horodatage et son chemin d’URI. »
- « Montrez les problèmes TCP que signale l’analyse experte, avec les numéros de trame. »
- « Décodez le port UDP 5684 comme du CoAP et exportez les codes. »
- « Capturez 30 secondes de trafic en provenance et à destination de 192.168.7.10 sur l’interface 3 dans captures/board.pcapng. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : lecture d’une capture enregistrée avec n’importe quelle option de filtre, de champ, de statistiques ou de sortie, aide, version et liste des interfaces. Les fichiers de sortie, comme une copie filtrée, sont écrits sans approbation.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : une capture en direct. Une commande sans `-r` capture aussi en direct, sur la première interface.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : une option que ce plugin ne reconnaît pas.
- **Bloqué** : les scripts Lua, qui peuvent exécuter du code arbitraire, et les mots de passe RPCAP sur la ligne de commande, qui seraient enregistrés dans les journaux d’exécution.

## Limites

- Windows x64 et Linux x64. Les règles ont été établies avec TShark 4.6.8.
- TShark charge les plugins Lua et binaires de votre propre profil Wireshark à chaque exécution ; les règles ne peuvent pas l’empêcher.
- Les interfaces distantes et extcap (sshdump, `rpcap://`) capturent sur d’autres hôtes. Configurez la capture à distance et ses identifiants en dehors de VERA.
