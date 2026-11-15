# Bases de données CAN (cantools)

Bases de données CAN transforme le trafic CAN capturé en signaux nommés avec leurs unités. L’agent décode des fichiers journaux ASC, BLF et candump avec une base de données DBC, KCD, SYM ou ARXML, et peut afficher, lister ou convertir des bases de données et en générer du code source C avec cantools. Il lit uniquement des fichiers ; il n’ouvre jamais de bus. Pour capturer du trafic, utilisez le plugin can-python.

## Prérequis

- **cantools** 45 depuis PyPI et **can-decode**, un script du plugin : tous deux installés automatiquement par **Installer les dépendances** sur la page du plugin.
- Une base de données CAN et un fichier journal capturé dans le banc de travail.
- Aucun plugin, matériel ni configuration requis.

## Utilisation

- « Listez les messages et les signaux de fixtures/board.dbc. »
- « Décodez captures/bus.asc avec fixtures/board.dbc et résumez les signaux. » (compétence `can-decode`)
- « Affichez uniquement les messages 0x100 et 0x200 des 200 premières trames. »
- « Convertissez board.dbc en KCD. »
- « Générez le code source C de board.dbc. »

Chaque ligne décodée indique l’horodatage, l’ID, le message et les valeurs des signaux avec leurs unités, suivie d’un résumé des trames décodées par message, des trames dont le décodage a échoué et des ID que la base de données ne définit pas. L’agent présente les ID inconnus comme du trafic que la base de données ne décrit pas, et non comme des erreurs, et cite la capture, la base de données et les horodatages des trames qui fondent chaque constat. Les longues captures sont réduites par ID de message et par nombre maximal de trames.

## Risques et approbations

Toutes les commandes autorisées par ce plugin sont sûres et s’exécutent sans demander : le décodage, l’affichage et la liste ne font que lire leurs entrées ; la conversion et la génération de code C écrivent leurs fichiers de sortie, comme les autres sorties d’analyse. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

Trois commandes cantools sont bloquées : `decode` et `plot` lisent les trames sur l’entrée standard, que VERA ferme, et `monitor` est une vue de terminal interactive qui ouvre un bus. L’agent utilise `can-decode` à la place.

## Limites

- Windows x64 et Linux x64.
- Une base de données qui échoue aux contrôles de cohérence de cantools peut tout de même être chargée sur demande (`--no-strict`) ; l’agent indique quand il l’a fait.
- Référence : https://cantools.readthedocs.io/en/latest/
