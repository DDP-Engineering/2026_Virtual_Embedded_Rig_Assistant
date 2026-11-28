# Moniteur série

Ce plugin permet à l’agent de lister les ports série de votre ordinateur avec leurs ID USB, leurs numéros de série et leur famille de cartes, de capturer la console d’une carte (éventuellement après une réinitialisation par DTR/RTS) et d’envoyer une ligne ou quelques octets à la carte. Utilisez-le pour savoir quel port utilise une carte et pour lire son journal de démarrage ou sa sortie console.

## Prérequis

- **serial**, un script Python du plugin basé sur pyserial 3.5, que VERA installe lui-même avec **Installer les dépendances**.
- Une carte connectée en série USB.
- Sous Linux, votre utilisateur doit appartenir au groupe propriétaire des ports série : `dialout` (Debian, Ubuntu, Fedora) ou `uucp` (Arch). L’agent affiche la commande, mais c’est vous qui l’exécutez et vous reconnectez.
- Aucun autre plugin et aucune configuration. Pour confirmer un type de puce ESP32, le plugin esp32-esptool est utile.

## Utilisation

L’agent utilise les compétences `serial-console`, `board-identify` et `esp32-identify`. Il liste les ports avant d’en utiliser un et ne devine jamais un nom de port ; sous Linux, il préfère le chemin stable `/dev/serial/by-id/...`.

- « Quelles cartes sont connectées, et sur quels ports ? »
- « Capturez la console de la carte du COM5 pendant 10 secondes. »
- « Réinitialisez l’ESP32 du COM7 et capturez le journal de démarrage jusqu’à l’appel de app_main. »
- « Envoyez help à la carte du COM5 et montrez la réponse. »
- « Suivez la console de la carte sur /dev/ttyUSB0 en arrière-plan jusqu’à ce que je dise stop. »
- « Capturez le journal de démarrage de la carte sur COM7 avec horodatage et dites-moi combien de temps dure le démarrage. »
- « Envoyez les octets 01 03 00 00 00 0A C5 CD au compteur sur COM9 à 19200 bauds, 8E1, et affichez la réponse. »
- « Lisez la console de la carte simulée sur socket://localhost:5555. »
- « Je ne connais pas le débit de la carte sur COM5 : trouvez-le et affichez la console. »
- « Pendant que vous suivez la console de la carte sur COM5, envoyez version et affichez la réponse. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : liste des ports, aide et version.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : capture de la console. L’ouverture du port seule ne redémarre pas la carte ; avec une réinitialisation, elle redémarre par DTR/RTS.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : envoi d’une ligne ou d’octets. Le firmware de la carte décide de l’effet de la ligne ; l’agent n’envoie donc que ce que vous avez demandé.

Tant qu’une capture en arrière-plan occupe un port, VERA refuse toute autre exécution sur ce port jusqu’à l’arrêt de la capture. Pour écrire à la carte entre-temps, l’agent envoie par cette capture au lieu d’ouvrir de nouveau le port.

## Limites

- Windows x64 et Linux x64.
- Une capture au premier plan dure au plus une heure ; les plus longues tournent en arrière-plan jusqu’à ce que vous les arrêtiez.
- Le terminal ou le socket d’un simulateur (`/dev/pts/N`, `socket://host:port`, `rfc2217://host:port`) sert de port. Il n’a pas de lignes de réinitialisation : relancez la simulation pour voir un journal de démarrage.
- « Accès refusé » sous Windows signifie qu’un autre programme, comme un terminal ou le moniteur d’un IDE, occupe le port.
- Un port sans famille reconnue n’est pas forcément la carte que vous attendez ; l’agent demande avant de l’utiliser.
- La sortie console est traitée comme des données provenant de l’appareil, jamais comme des instructions.
