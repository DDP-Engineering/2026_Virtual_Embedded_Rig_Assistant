# Projets Linux sur Raspberry Pi

Ce plugin permet à l’agent de travailler sur un Raspberry Pi que VERA joint en SSH : déployer un projet, exécuter ses tâches et afficher leur sortie, exécuter une commande, installer des paquets Python et système, gérer des services qui démarrent au boot, lire l’état de la carte et récupérer des fichiers. VERA se connecte comme `ssh`, avec la clé que vous utilisez déjà.

## Prérequis

- **pi-tool**, un script Python que VERA installe lui-même avec **Installer les dépendances**.
- **Un Raspberry Pi** sous Raspberry Pi OS 12 (Bookworm) 64 bits, avec SSH activé et Python 3.9 ou plus récent.
- **Le registre du banc** `lab/resources.json` dans le banc de travail (obligatoire), qui déclare la carte comme `linux-board`. L’hôte et l’utilisateur suffisent ; l’agent écrit l’entrée quand vous les indiquez.
- **Une clé SSH** : une clé de l’agent SSH, ou une clé privée de `~/.ssh` sans phrase secrète, dont la moitié publique est autorisée sur la carte. VERA ne manipule jamais de mot de passe ni de phrase secrète.
- **Un manifeste de projet** `vera-pi.json` dans un dossier de projet (facultatif) : les fichiers à déployer, les dépendances Python, les tâches et les services.

La section **Configuration** de la page du plugin indique l’état de chacun.

## Utilisation

L’agent utilise les compétences `raspberry-pi-projects` et `raspberry-pi-tasks`.

- « Mon Pi est raspberrypi.local, utilisateur pi. Connectez-vous et dites-moi comment il se porte. »
- « Exécutez le projet blink sur pi. »
- « Installez i2c-tools sur pi et scannez le bus I2C. »
- « Faites démarrer blink au boot et montrez-moi ses journaux. »

La première connexion enregistre la clé d’hôte de la carte. Si vous réinstallez le système de la carte, la clé change et VERA la refuse jusqu’à ce que vous demandiez à l’agent de faire confiance à la nouvelle.

## Risques et approbations

- **Sûr** (exécuté sans demander) : vérifications hors ligne du manifeste et rapports.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : vérification de la clé d’hôte, identité et état de la carte, comparaison d’un projet avec la carte, état des tâches et des services, journaux et récupération d’un fichier.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : déploiement des fichiers (aucun n’est supprimé), exécution d’une tâche ou d’une commande, démarrage ou arrêt d’un service, acceptation d’une nouvelle clé d’hôte et nettoyage de VERA. Le code du projet et les commandes peuvent piloter le matériel relié à la carte. **Toujours autoriser** sur la carte laisse une commande telle que `pi-tool run-task` s’exécuter sans demander en mode **Modification auto**.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : déploiement avec `--overwrite`, qui remplace les fichiers modifiés sur la carte ; ces modifications sont perdues. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

## Limites

- VERA s’exécute sous Windows x64 ou Linux x64 ; les cartes autres qu’un Raspberry Pi ne sont pas revendiquées.
- Une commande qui nécessite `sudo` ne fonctionne que si la carte l’autorise sans mot de passe, comme l’utilisateur par défaut de Raspberry Pi OS.
- `~/.ssh/config` n’est pas lu : indiquez dans le registre l’hôte et l’utilisateur réels de la carte.
- Le plugin n’a pas encore été exécuté avec un vrai Raspberry Pi.
