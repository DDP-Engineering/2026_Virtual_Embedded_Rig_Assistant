# Documentation électrique

La documentation électrique permet à l'agent d'établir les listes de votre projet - matériel, fils (connexions), câbles, bornes, étiquettes et E/S, avec un sommaire - à partir de ce que VERA connaît déjà : le modèle électrique, une vérification d'armoire enregistrée et les schémas QElectroTech que vous nommez. Chaque ligne indique le fichier dont elle provient avec le hash de ce fichier, et les listes sont vérifiées entre elles.

## Ce qu'il faut

- **Aucun programme.** L'agent utilise les outils intégrés de VERA `electrical_documentation`, `electrical_documentation_check` et `electrical_documentation_export`, proposés seulement tant que ce plugin est activé. Il n'y a rien à installer ni à télécharger, donc **Installer les dépendances** n'a rien à faire ici.
- Une vérification d'armoire enregistrée (plugin Panel engineering) et les schémas QElectroTech des moteurs (plugin QElectroTech schematics).
- Pour les tags API, facultativement un fichier de tags exporté de votre outil API : un fichier CSV avec les colonnes `name` et `address` (et facultativement `dataType`, `comment`). Aucun projet API n'est ouvert.
- Pour la révision, un objet document dans le modèle électrique avec un attribut `revision` (et facultativement `date`, `author`).

## Utilisation

- « Fais la documentation de l'armoire MCP1 à partir de la dernière vérification d'armoire et des schémas de M1 et M2, avec les tags de plc/tags.csv. » (skill `electrical-documentation`)
- « Montre-moi la liste des fils. »
- « Quelles E/S n'ont pas de tag ou ont une autre adresse dans le fichier de tags ? »
- « Qu'est-ce qui a changé depuis la dernière exécution de documentation ? »
- « Exporte la liste des bornes en CSV et le tout en PDF. »

Le résultat est enregistré dans `electrical-automation-results/<run-id>/` ; les exports sont écrits à côté comme nouveaux fichiers.

## Ce qui est vérifié

- La numérotation des fils : un numéro par potentiel, aucun numéro sur deux potentiels, chaque conducteur numéroté et raccordé aux deux extrémités, jamais deux conducteurs entre les mêmes bornes.
- Les repères dessinés dans un schéma qui ne sont ni dans l'armoire ni dans le modèle, et les connexions de démarreur que le schéma ne dessine pas.
- Les câbles sans extrémité côté armoire ou côté charge et les bornes au-delà de la taille de leur bornier.
- Pour chaque E/S : l'appareil, la borne physique, l'adresse sur un module API de l'armoire et exactement un tag, ainsi que la même adresse dans le fichier de tags.
- La révision : un contenu modifié sous la même révision ou un folio de schéma avec une autre révision.

## Risques et approbations

`electrical_documentation` ne fait que lire. `electrical_documentation_check` et `electrical_documentation_export` sont des outils d'écriture : ils demandent votre approbation comme l'écriture d'un fichier et ne sont pas proposés dans les sessions Read-only. Ils n'écrivent que leur nouveau fichier de résultat ou d'export ; le modèle, le fichier d'armoire, les schémas et le fichier de tags ne sont jamais modifiés - les écarts vous sont signalés pour que vous les corrigiez. Rien n'est imprimé, commandé ni envoyé.

## Limites

- Les listes ne contiennent que ce que contiennent le modèle, la vérification d'armoire, les schémas nommés et le fichier de tags ; la révision et l'auteur ne sont jamais inventés.
- Les exports sont en anglais. Le texte PDF utilise la police standard Courier : les caractères hors de l'écriture d'Europe occidentale apparaissent comme `?`.
- Vérifié sous Windows x64 et avec des projets au format QElectroTech écrits par VERA ; pas encore exécuté sous Ubuntu x64 natif ni sur des projets numérotés enregistrés par QElectroTech.
