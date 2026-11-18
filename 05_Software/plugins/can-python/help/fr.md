# Bus CAN (python-can)

Bus CAN permet à l’agent de trouver des adaptateurs CAN, de capturer un bus en écoute seule vers un journal ASC, BLF ou candump, et d’envoyer des trames isolées ou de rejouer un journal sur un bus actif au moyen de python-can. Les interfaces prises en charge sont PEAK, Vector, Kvaser, slcan, gs_usb (candleLight) et SocketCAN, ainsi qu’un bus logiciel (`udp_multicast`) pour répéter sans matériel. Décodez les captures avec le plugin can-dbc.

## Prérequis

- **can** : un script sur python-can 4.6.1, installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Un adaptateur CAN et le pilote de son fabricant, que vous installez vous-même ; VERA n’installe jamais de pilotes. `can list` signale chaque pilote manquant avec une indication : le pilote PEAK avec PCAN-Basic, l’installation du pilote Vector et la XL Driver Library (Windows), les pilotes Kvaser et CANlib, WinUSB via Zadig pour gs_usb sous Windows.
- Sous Linux, activez vous-même une liaison SocketCAN, par exemple en écoute seule au bon débit, ou créez un bus virtuel `vcan0`.
- L’interface, le canal et le débit de votre bus. L’agent ne devine jamais un débit.
- Aucun paramètre de configuration.

## Utilisation

- « Quelles interfaces et quels pilotes CAN sont disponibles ? »
- « Capturez 10 secondes du bus sur PCAN_USBBUS1 à 500 kbit/s dans captures/bus.asc. » (compétence `can-capture`)
- « Enregistrez 2000 trames de can0 dans captures/can0.blf en arrière-plan. »
- « Envoyez l’ID 0x200 avec les données E80301 sur PCAN_USBBUS1 à 500 kbit/s. » (compétence `can-transmit`)
- « Rejouez les 50 premières trames de captures/startup.asc en capturant la réponse. »

## Risques et approbations

- Sûr, exécuté sans demander : liste des interfaces et des pilotes.
- Lecture appareil : une capture en écoute seule. Les adaptateurs PEAK, Vector, Kvaser et slcan sont ouverts de façon à ne jamais acquitter de trames ; une liaison SocketCAN n’entre dans cette catégorie que si vous l’avez activée en écoute seule.
- Écriture appareil : une capture avec `--active`, où l’adaptateur rejoint le bus et acquitte les trames ; un mauvais débit peut provoquer des trames d’erreur qui perturbent les autres nœuds. L’agent vous demande avant de l’ajouter.
- Irréversible : `send` et `replay`, qui émettent sur un bus actif ; les ECU destinataires agissent immédiatement sur les trames. VERA vous demande de taper `send` ou `replay` pour confirmer, sauf en mode Contournement.

En mode Demander, VERA demande avant chaque capture ; le mode Modification auto exécute les captures en écoute seule sans demander.

## Limites

- Windows x64 et Linux x64.
- Les vrais adaptateurs et `vcan0` sous Linux ne sont pas encore couverts par les tests de VERA ; l’écoute seule est demandée au backend et n’est pas relue sur l’adaptateur.
- Une capture limitée seulement par un nombre de trames se termine au plus tard après 240 secondes ; demandez une durée pour enregistrer plus longtemps.
- Une capture `.blf` arrêtée avant la fin de sa durée peut être incomplète ; `.asc` et `.log` sont écrits trame par trame.
- Les réglages du bus proviennent uniquement de la ligne de commande ; `~/.canrc`, `can.ini` et les variables `CAN_*` sont ignorés.
- Référence : https://python-can.readthedocs.io/en/v4.6.1/
