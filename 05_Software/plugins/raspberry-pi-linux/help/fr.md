# Projets Linux sur Raspberry Pi

Ce plugin permet à l’agent de déployer des projets, d’exécuter des tâches finies et de gérer des services utilisateur sur un Raspberry Pi que VERA joint en SSH. Chaque connexion vérifie la clé d’hôte épinglée de la carte, son identité, l’utilisateur et la racine distante. Un petit utilitaire installé sur la carte n’applique que les fichiers approuvés, exécute les tâches déclarées avec un budget de temps, et démarre, arrête et lit les services utilisateur listés. Il n’y a pas d’accès shell, sudo, aux services système, au GPIO brut, à l’I2C ou au SPI, ni de redémarrage.

## Prérequis

- **pi-tool**, un script Python que VERA installe lui-même avec **Installer les dépendances**.
- **Un Raspberry Pi** sous Raspberry Pi OS 12 (Bookworm) 64 bits, avec un utilisateur non privilégié disposant d’un gestionnaire utilisateur systemd et Python 3.9 ou plus récent.
- **Le registre du banc** `lab/resources.json` dans le banc de travail (obligatoire), qui déclare la carte comme `linux-board` : hôte, utilisateur, empreintes de clé d’hôte épinglées, clé de l’agent, numéro de série ou identifiant de machine, et dossier racine distant.
- **Un manifeste de projet** `vera-pi.json` dans un dossier de projet (facultatif) : les fichiers à déployer, les tâches et les services utilisateur.
- **L’agent SSH du système** contenant votre clé de connexion (sous Windows, l’OpenSSH Authentication Agent ou Pageant). VERA ne manipule jamais de mot de passe ni de fichier de clé.

La section **Configuration** de la page du plugin indique l’état de chacun.

## Utilisation

L’agent utilise les compétences `raspberry-pi-projects` et `raspberry-pi-tasks`. Comparez la clé d’hôte sur la console même de la carte avant de l’épingler.

- « Vérifiez la clé d’hôte de la carte pi, puis installez l’utilitaire et identifiez la carte. »
- « Préparez blink/vera-pi.json sur pi et montrez-moi quels fichiers changent. »
- « Exécutez la tâche selftest de blink-demo sur pi. »
- « Démarrez blink-demo.service et récupérez ses journaux. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : vérifications hors ligne du manifeste et rapports.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : vérification de la clé d’hôte, identification de la carte, état et journaux des tâches et des services.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : installation de l’utilitaire, préparation et application des fichiers (aucun n’est supprimé), exécution d’une tâche, démarrage ou arrêt d’un service, et nettoyage de VERA. Le code du projet peut piloter le matériel relié à la carte.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : application avec `--overwrite`, qui remplace les fichiers modifiés sur la carte ; ces modifications sont perdues. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

## Limites

- VERA s’exécute sous Windows x64 ou Linux x64 ; les autres cartes ne sont pas revendiquées.
- Une clé d’hôte modifiée est refusée, jamais acceptée.
- Un service qui doit continuer à tourner après la session nécessite `loginctl enable-linger <user>` sur la carte, que VERA n’exécute jamais.
- Le plugin n’a pas encore été exécuté avec un vrai Raspberry Pi.
