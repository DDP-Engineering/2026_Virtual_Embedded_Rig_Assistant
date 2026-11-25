# Wireshark (TShark)

Pour comparer hors ligne deux captures enregistrées, indiquez la référence, le candidat, les points d’observation et les fenêtres temporelles. Le rapport indique les différences TCP et UDP, les temps DNS et HTTP disponibles, les preuves manquantes et les liens vers les trames originales. Demandez à l’agent d’enregistrer le rapport localement.

Demandez à l’agent d’importer un dump hexadécimal firmware ou UART au format PCAPNG. Indiquez si les données contiennent des trames Ethernet complètes, des charges utiles opaques ou nécessitent des en-têtes IPv4/UDP synthétiques. Précisez si le dump contient des heures UTC. Le manifeste de provenance indique le hachage de la source et les métadonnées synthétiques. L’importation nécessite Text2pcap.

Demandez à l’agent d’inspecter les métadonnées, de sélectionner des trames, ou de scinder, fusionner, réordonner, dédupliquer, convertir ou nettoyer des captures enregistrées. Les fichiers d’origine sont conservés. Les captures nettoyées peuvent encore contenir des données de paquets et des identifiants. L’agent peut exporter localement les champs, PDU et corps HTTP pris en charge. La disponibilité dépend des utilitaires Wireshark installés.

Pour analyser le réseau, demandez des informations sur Ethernet et les VLAN, IPv4 et IPv6, ARP et la découverte de voisins, DNS et DHCP, TCP et UDP, le multicast ou les métadonnées TLS visibles. Les preuves compactes masquent les adresses et les noms tout en conservant les liens vers les trames et les limites de la capture.

Pour le trafic Ethernet automobile enregistré, demandez à l’agent une analyse DoIP, SOME/IP ou Service Discovery. Il peut indiquer le sens, le VLAN, les champs PDU et les trames contributrices. Indiquez le port du service SOME/IP si nécessaire.

L’outil hors ligne répertorie les conversations et les terminaux, mesure le trafic et les temps de réponse DNS ou HTTP et affiche les informations d’expert par trame. Ouvrez une trame citée dans Wireshark Desktop pour examiner localement le contenu du flux.

Utilisez l’outil hors ligne pour sélectionner des champs, filtrer des paquets et citer des trames d’une capture vérifiée. Importez une capture pour conserver le fichier vérifié dans l’espace de travail.

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

- **Sûr** (exécuté sans demander) : lecture d’une capture enregistrée avec n’importe quelle option de filtre, de champ, de statistiques ou de sortie, aide, version et liste des interfaces.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : une capture en direct, et toute commande qui écrit un fichier ou un dossier (`-w`, `--export-objects`, `--export-tls-session-keys`, `--log-file`), par exemple une copie filtrée d’une capture. Une commande sans `-r` capture aussi en direct, sur la première interface.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : une option que ce plugin ne reconnaît pas.
- **Bloqué** : les scripts Lua, qui peuvent exécuter du code arbitraire, et les mots de passe RPCAP sur la ligne de commande, qui seraient enregistrés dans les journaux d’exécution.

## Limites

- Windows x64 et Linux x64. Les règles ont été établies avec TShark 4.6.8.
- L’analyse hors ligne utilise un profil Wireshark isolé. Les exécutions TShark génériques chargent votre profil Wireshark et ses extensions.
- Les interfaces distantes et extcap (sshdump, `rpcap://`) capturent sur d’autres hôtes. Configurez la capture à distance et ses identifiants en dehors de VERA.
