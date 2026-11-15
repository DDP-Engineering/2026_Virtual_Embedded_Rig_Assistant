# Arduino CLI

Arduino CLI compile et téléverse des sketches Arduino natifs (projets `.ino`) avec un arduino-cli épinglé, sans l’IDE Arduino. L’agent examine un sketch, liste les cartes connectées par leur identité, recherche et installe des cores et des bibliothèques en versions exactes, compile une copie du sketch dans un dossier d’exécution traçable et téléverse exactement ce binaire vérifié sur une carte identifiée. Tout s’exécute dans l’environnement Arduino propre à VERA (`~/.vera-arduino`, `%USERPROFILE%\.vera-arduino` sous Windows) ; les dossiers de l’IDE Arduino ne sont jamais lus ni modifiés. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **arduino-cli** 1.6.0 : sur la page du plugin, **Installer les dépendances** le télécharge et vérifie son SHA-256. Un arduino-cli 1.6 ou plus récent (inférieur à 2) que vous avez installé vous-même depuis https://arduino.github.io/arduino-cli/latest/installation/ est trouvé dans le PATH ; le téléchargement épinglé est préféré.
- **arduino-tool** : un script du plugin, installé automatiquement.
- Le plugin **serial-monitor**, qui lit la console de la carte après un téléversement. **Installer avec les dépendances** l’ajoute.
- Une carte Arduino connectée en USB. Sous Linux, votre utilisateur doit appartenir au groupe propriétaire des ports série (`dialout` sous Debian, Ubuntu et Fedora).
- Aucun paramètre de configuration.

## Utilisation

- « Compilez le sketch Blink pour un Arduino Uno et indiquez l’occupation de la flash et de la RAM. » (compétence `arduino-build-fix`)
- « La compilation indique que Adafruit_BME280.h est introuvable. Trouvez et installez la bonne bibliothèque. » (compétence `arduino-libraries`)
- « Quelles cartes sont connectées ? »
- « Écrivez un petit sketch qui affiche les mesures du BME280, téléversez-le sur l’Uno du COM5 et montrez-moi la bannière. » (compétence `arduino-test-sketch`)

L’agent vous demande quelle carte et quel port utiliser quand plusieurs sont connectées ou que la carte se trouve derrière une puce de pont USB (CH340, FTDI, CP210x). Il demande avant d’installer un core ou une bibliothèque, car il s’agit d’un téléchargement. Après un téléversement, il lit la bannière de démarrage avec le moniteur série.

## Risques et approbations

- Sûr, exécuté sans demander : examen d’un sketch, recherches de cartes, de cores et de bibliothèques, rapports d’exécution et nettoyage du cache de build de VERA.
- Lecture appareil : liste des cartes (ports série et découverte mDNS) et compilation, qui exécute le compilateur et les hooks de build du core sur cet ordinateur.
- Écriture appareil : installation de cores, de bibliothèques et d’index dans l’environnement Arduino de VERA, et téléversement, qui écrit la flash de la carte et démarre immédiatement le nouveau firmware. Avec un programmateur, un téléversement écrase aussi le bootloader.
- Bloqué : toute commande `arduino-cli` directe.

En mode Demander, VERA demande avant chaque commande de lecture appareil et d’écriture appareil ; le mode Modification auto exécute les commandes de lecture appareil sans demander.

## Limites

- Windows x64 et Linux x64.
- Pas de démon, de moniteur interactif, de gravure de bootloader, de fusibles ni de téléversement OTA.
- Un `sketch.yaml` est signalé et ignoré. Les dépendances de bibliothèques ne sont pas installées automatiquement ; chacune est installée explicitement dans une version exacte.
