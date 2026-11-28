# Arduino CLI

Arduino CLI compile et téléverse des sketches Arduino natifs (projets `.ino`) avec un arduino-cli épinglé, sans l’IDE Arduino. L’agent installe des cores et des bibliothèques, compile un sketch, téléverse le build sur votre carte et lit ce que la carte affiche, en une seule étape si vous le demandez. Tout s’exécute dans l’environnement Arduino propre à VERA (` /.vera-arduino`, `%USERPROFILE%\.vera-arduino` sous Windows) ; les dossiers de l’IDE Arduino ne sont jamais lus ni modifiés. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **arduino-cli** 1.6.0 : sur la page du plugin, **Installer les dépendances** le télécharge et vérifie son SHA-256. Un arduino-cli 1.6 ou plus récent (inférieur à 2) que vous avez installé vous-même depuis https://arduino.github.io/arduino-cli/latest/installation/ est trouvé dans le PATH ; le téléchargement épinglé est prioritaire.
- **arduino-tool** : un script du plugin, installé automatiquement.
- Le plugin **serial-monitor**, pour observer plus longtemps la console de la carte. **Installer avec les dépendances** l’ajoute.
- Une carte Arduino connectée en USB. Sous Linux, votre utilisateur doit appartenir au groupe propriétaire des ports série (`dialout` sous Debian, Ubuntu et Fedora).
- Aucun paramètre de configuration.

## Utilisation

- « Compilez le sketch Blink pour un Arduino Uno et indiquez l’utilisation de la flash et de la RAM. » (compétence `arduino-build-fix`)
- « La compilation indique que Adafruit_BME280.h est manquant. Installez la bonne bibliothèque. » (compétence `arduino-libraries`)
- « Écrivez un petit sketch qui affiche les mesures du BME280, téléversez-le et montrez-moi ce qu’il affiche. » (compétence `arduino-test-sketch`)
- « Retenez que ce sketch est pour le Nano sur COM7. »
- « Quelles cartes sont connectées ? »
- « Partez du sketch d’exemple de la bibliothèque BME280. »
- « Le sketch ne tient plus sur l’Uno. Qu’est-ce qui occupe le plus de flash ? »

L’agent trouve lui-même la carte et le port lorsqu’une seule convient, et vous demande lorsque plusieurs sont connectées. Une carte placée derrière une puce pont USB (CH340, FTDI, CP210x) ne peut pas s’identifier ; dites à l’agent de quelle carte il s’agit. Le téléversement s’exécute alors avec la mention que le modèle n’a pas été vérifié.

## Risques et approbations

- Sûr, exécuté sans demander : examen d’un sketch, liste des cartes et des exemples de bibliothèques, recherches de cartes, de cores et de bibliothèques, compilation (qui exécute le compilateur et les hooks de build du core sur cet ordinateur), rapports d’exécution et nettoyage des dossiers de build de VERA.
- Lecture appareil : installation de cores, de bibliothèques et d’index, qui télécharge dans l’environnement Arduino de VERA, mémorisation de la carte et du port d’un sketch dans son `sketch.yaml`, copie d’un exemple de bibliothèque dans le banc de travail comme nouveau sketch et suppression des anciens dossiers d’exécution.
- Écriture appareil : téléversement, par USB ou par le réseau, y compris dans le cadre d’une compilation, qui écrit la flash de la carte et démarre aussitôt le nouveau firmware ; et toute autre commande arduino-cli que l’agent transmet avec `arduino-tool cli`.
- Irréversible : téléversement avec `--programmer` ou gravure d’un bootloader, qui écrase le bootloader. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.
- Bloqué : toute commande `arduino-cli` directe.

En mode Demander, VERA demande avant chaque commande de lecture ou d’écriture appareil ; le mode Modification auto exécute les commandes de lecture appareil sans demander.

## Limites

- Windows x64 et Linux x64. Le téléversement et la lecture du port série n’ont pas encore été exécutés sur une vraie carte.
- Le téléversement par le réseau (OTA) n’a pas non plus été exécuté sur une vraie carte.
- Les commandes qui attendent une saisie, comme le moniteur et le débogueur interactifs d’arduino-cli, et son démon ne sont pas exécutés.
- Les profils d’un `sketch.yaml` ne sont pas utilisés ; sa carte et son port par défaut le sont.
