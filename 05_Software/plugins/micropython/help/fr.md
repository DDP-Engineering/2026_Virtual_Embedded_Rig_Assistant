# MicroPython

Ce plugin permet à l’agent de travailler avec une carte qui exécute déjà MicroPython 1.22 ou plus récent. Il liste les ports série, identifie le firmware de la carte, liste et lit ses fichiers, déploie un fichier du banc de travail via une copie temporaire vérifiée, exécute un script du banc de travail depuis la RAM avec une échéance et un verdict réussi/échoué, capture la console et réinitialise la carte. Il n’y a pas de REPL interactif ni d’installation de firmware. Les résultats vont dans `arduino-iot-results/`.

## Prérequis

- **micropython-tool**, un script Python du plugin avec un mpremote épinglé, que VERA installe lui-même avec **Installer les dépendances**.
- Une carte connectée en série USB qui exécute déjà MicroPython 1.22 ou plus récent. Les autres firmwares, CircuitPython compris, sont refusés. Pour installer MicroPython, utilisez d’abord l’outil du fabricant de la carte (par exemple esptool pour un ESP32).
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `micropython-deploy` et `micropython-test-script`. Il désigne la carte par son port et par l’identité qu’affiche la liste des ports, et vous demande quelle carte se trouve derrière un pont USB-série.

- « Listez les ports série et identifiez la carte MicroPython sur COM5. »
- « Montrez les fichiers de /lib sur la carte et l’espace libre. »
- « Déployez app/sensor.py vers /lib/sensor.py sur la carte, puis redémarrez-la. »
- « Écrivez un script qui balaie le bus I2C, exécutez-le sur la carte avec un délai de 30 secondes et donnez-moi le verdict. »
- « Capturez la console de la carte pendant 10 secondes après un redémarrage. »

## Risques et approbations

Presque toutes les opérations sur la carte interrompent le programme qu’elle exécute (Ctrl-C) ; l’agent le signale donc d’abord. Avec `--restart`, le programme redémarre ensuite.

- **Sûr** (exécuté sans demander) : liste des ports sans les ouvrir et résumé des dossiers d’exécution.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : identification de la carte, liste et lecture des fichiers, capture de la console et réinitialisation de la carte, qui relance le programme enregistré.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : déploiement d’un fichier et exécution d’un script depuis la RAM. L’approbation est liée au hash du fichier. Un script peut piloter les broches de la carte et tout ce qui y est câblé.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : remplacement de boot.py ou main.py, qui s’exécutent à chaque démarrage ; un fichier défectueux peut bloquer l’accès au REPL jusqu’à la réinstallation du firmware. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

## Limites

- Windows x64 et Linux x64.
- Il n’y a pas de sauvegarde ni de restauration des fichiers de la carte.
- Arrêter ne termine que l’utilitaire sur votre ordinateur ; le code déjà en cours d’exécution sur la carte continue de tourner.
- VERA réserve le port série pour l’exécution.
