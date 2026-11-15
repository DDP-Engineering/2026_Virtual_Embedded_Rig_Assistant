# CircuitPython

CircuitPython place du code et des bibliothèques compatibles sur une carte qui exécute déjà CircuitPython 9, 10 ou 11. L’agent liste les lecteurs CIRCUITPY et les ports série par leur identité, examine le firmware, le code et `/lib`, prépare les bibliothèques à partir d’une étiquette de bundle Adafruit épinglée, déploie les fichiers approuvés un par un en vérifiant chacun, et capture l’exécution qui suit dans la console. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **circuitpython-tool** : un script installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Une carte qui exécute CircuitPython 9, 10 ou 11, connectée en USB avec son lecteur CIRCUITPY monté. L’installation du firmware (UF2) vous revient ; ce plugin ne la fait jamais.
- L’étiquette du bundle Adafruit à épingler, une date de version de l’Adafruit CircuitPython Bundle (voir https://circuitpython.org/libraries). L’agent vous la demande quand le banc de travail n’en utilise pas déjà une.
- Aucun plugin requis et aucun paramètre de configuration.

## Utilisation

- « Quelles cartes CircuitPython sont connectées ? » (compétence `circuitpython-deploy`)
- « Identifiez la carte sur E: et montrez le code et les bibliothèques qu’elle contient. »
- « Vérifiez si les bibliothèques de /lib correspondent au firmware de la carte. » (compétence `circuitpython-libraries`)
- « Préparez adafruit_bme280 et neopixel pour CircuitPython 9 à partir du bundle 20261110. »
- « Déployez app/code.py avec cet ensemble de bibliothèques sur la carte E: et capturez 10 secondes de sortie console depuis COM7. »

Avant d’écrire, l’agent peut examiner le lecteur afin qu’un déploiement refuse les fichiers que vous avez modifiés sur la carte depuis. `settings.toml` et `secrets.py` sont listés mais jamais lus.

## Risques et approbations

- Sûr, exécuté sans demander : liste des lecteurs et des ports, et rapports d’exécution.
- Lecture appareil : identification de la carte, examen de son code et de ses bibliothèques, et lecture de la console sans rien envoyer.
- Écriture appareil : préparation des bibliothèques (un téléchargement depuis github.com vers le cache de VERA et le banc de travail ; aucune carte n’est touchée), déploiement de fichiers sur le lecteur, et capture de console avec `--reload`, qui arrête et redémarre `code.py`. Le nouveau code s’exécute juste après un déploiement et peut piloter tout ce qui est câblé aux broches de la carte ; Arrêter ne l’interrompt pas.
- Irréversible : un déploiement avec `--boot`, qui remplace `boot.py`. Il peut rendre le lecteur inaccessible depuis cet ordinateur ou désactiver l’USB jusqu’à ce que la carte soit démarrée en mode sans échec. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.

En modes Demander et Modification auto, VERA demande avant chaque commande d’écriture appareil.

## Limites

- Windows x64 et Linux x64.
- Pas de REPL, pas de code passé en argument, pas d’installation de firmware ni de mise à jour de toutes les bibliothèques.
- Un lecteur USB n’offre pas de transaction sur plusieurs fichiers : après un débranchement ou un arrêt, le résultat indique quels fichiers sont confirmés.
- Référence : https://docs.circuitpython.org/en/latest/docs/workflows.html
