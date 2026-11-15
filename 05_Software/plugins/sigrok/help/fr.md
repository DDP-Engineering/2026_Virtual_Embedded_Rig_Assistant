# sigrok (fork DDP)

Ce plugin permet à l’agent de capturer et de décoder des signaux numériques et analogiques, et de lire ou de configurer des instruments de banc au moyen de sigrok-cli. Les captures sont limitées et enregistrées sous forme de fichiers srzip dans le banc de travail ; les captures enregistrées peuvent être décodées hors ligne avec UART, I2C, SPI, CAN, 1-Wire et, dans le fork DDP, une pile de décodeurs Ethernet. Le fork DDP de sigrok ajoute des pilotes pour l’analyseur logique ATK-DL16 et l’oscilloscope à signaux mixtes Hantek DSO-3062L.

## Prérequis

- **sigrok-cli.** **Installer les dépendances** propose un paquet du fork DDP épinglé par SHA-256 pour la plateforme actuelle ; il a priorité sur une copie locale. Tant qu’il n’est pas installé, VERA utilise un sigrok-cli présent dans le PATH (sous Linux aussi `/usr/bin/sigrok-cli`). Un sigrok-cli officiel peut décoder des protocoles et utiliser les appareils qu’il liste, mais il lui manque les pilotes du fork.
- **Un instrument pris en charge** et l’accès USB, que vous configurez vous-même. Sous Linux, installez les règles udev du fork et de libsigrok, rejoignez le groupe `plugdev` et reconnectez-vous. Sous Windows, associez WinUSB avec Zadig au Hantek, à l’ATK-DL16 ou à l’appareil de classe fx2lafw si nécessaire.
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `sigrok-capture`, `sigrok-decode`, `sigrok-instruments`, `atk-dl16` et `hantek-dso3062l`. Il vérifie quels pilotes possède le sigrok-cli installé et ne devine jamais une connexion.

- « Capturez 100 000 échantillons de D0 à D2 sur l’ATK-DL16 à 10 MHz dans captures/logic.sr. »
- « Déclenchez sur un front montant de D8 et capturez un tampon. »
- « Prenez une trame unique depuis le Hantek DSO-3062L. »
- « Décodez l’UART sur D0 à 115200 bauds dans captures/logic.sr. »
- « Lisez la tension de l’alimentation Korad sur COM3. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : aide, version, listes des éléments pris en charge et décodage d’une capture enregistrée.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : recherche d’appareils, liste des ports série, affichage d’un pilote, lecture de valeurs et captures limitées avec un pilote explicite.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : modification des réglages d’un instrument, y compris une lecture qui applique d’abord des réglages.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : modification des réglages d’alimentations, de charges électroniques, de générateurs de signaux, de relais et d’instruments similaires qui pilotent des sorties, tout réglage sans pilote explicite, et la sortie du générateur PWM de l’ATK-DL16. En mode **Contournement — accès complet**, ces commandes s’exécutent sans demander.

## Limites

- Windows x64, Linux x64 et Linux ARM64.
- Les paquets épinglés pointent vers une version privée qui n’est pas encore publiée ; en attendant, utilisez un sigrok-cli présent dans le PATH.
- Une chaîne de version locale ne prouve pas que les pilotes du fork sont présents ; l’agent vérifie lui-même la présence de `atk-dl16` et `hantek-dso3062l`.
- Un déclencheur qui ne se déclenche jamais peut ne donner aucun échantillon et aucun fichier.
