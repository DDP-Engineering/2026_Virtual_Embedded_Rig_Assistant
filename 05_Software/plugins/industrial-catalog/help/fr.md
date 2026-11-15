# Catalogue industriel et sélection documentée

Catalogue industriel et sélection documentée permet à l’agent de choisir des équipements basse tension d’après les preuves du fabricant, et non de mémoire ni d’après le texte d’un distributeur. Il couvre les contacteurs, les disjoncteurs-moteurs, les protections, les variateurs, les modules d’automate et d’E/S et les accessoires. Les catalogues sont des fichiers du banc de travail qui tiennent la référence de commande du fabricant, la variante et les accessoires à part des SKU des distributeurs ; chaque paramètre est cité avec sa source, sa révision et sa page ou son tableau, dans ses conditions. L’agent sélectionne d’après vos exigences fermes, explique chaque élimination et indique ses sources, ses unités et ses limites. Il fonctionne hors ligne et ne touche à aucun matériel.

## Prérequis

- Aucun programme et rien à installer : le plugin n’en a pas. L’agent utilise l’outil intégré `industrial_catalog` de VERA, proposé uniquement tant que le plugin est activé.
- Un catalogue dans `electrical-automation-catalogs/` du banc de travail. Vous ou l’agent pouvez en écrire ou en importer un par une écriture de fichier ordinaire approuvée ; un fichier défectueux est listé sans arrêter les autres.
- Vos exigences avec leurs conditions : la tension, la catégorie d’emploi, la température ambiante. L’agent demande une valeur manquante au lieu de supposer une marge.
- Aucun plugin, matériel ni configuration requis.

## Utilisation

- « Quels contacteurs du catalogue conviennent à un moteur de 4 kW, 400 V, en AC-3, avec une bobine de 230 V ? » (compétence `industrial-selection`)
- « Trouvez l’article de référence LC1D09P7 et dites-moi si mon numéro est une référence de commande ou un SKU de distributeur. »
- « Quels disjoncteurs-moteurs supportent 20 kA à 400 V et se règlent à 8,5 A ? »
- « Pourquoi cet article a-t-il été éliminé, et quelles valeurs restent inconnues ? »
- « La coordination par fusibles de ces deux produits exacts est-elle valable à 400 V ? »
- « Proposez ce contacteur pour le modèle avec fabricant et référence de commande, le catalogue comme source. »

Chaque résultat est admissible, inconnu ou éliminé, et chaque valeur est citée avec ses conditions et sa source. Un prix plus bas, un stock plus important ou un nom proche ne rendent jamais deux articles équivalents. L’agent n’écrit jamais de lui-même dans le catalogue.

## Risques et approbations

L’outil `industrial_catalog` ne fait que lire des fichiers : il ne demande aucune approbation, ne cherche rien en ligne et ne stocke rien. Écrire un catalogue, ou une modification du modèle qui consigne votre choix (`electrical_model_change`), demande une approbation comme toute écriture de fichier. Rien n’est aspiré sur des sites, commandé ni remplacé dans un schéma ; il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Les valeurs manquantes ou non confirmées restent inconnues et ne passent jamais. Une valeur marquée extraite n’est pas vérifiée dans la source et ne décide jamais d’une exigence.
- Les tableaux de coordination ne valent que pour les produits, la tension et les conditions exacts qu’ils nomment ; sinon la coordination reste inconnue.
- Aucun catalogue complet de fabricant ni tableau CEI n’est fourni. Le jeu d’essai inclus est petit et cité, quelques contacteurs et disjoncteurs-moteurs relevés sur des pages produit publiques, et les tableaux de coordination sous licence des fabricants n’y figurent pas. Ne saisissez que des valeurs que vous avez le droit d’utiliser et notez les conditions de licence de chaque source.
- Les prix et stocks en direct viennent du plugin parts-search et ne sont qu’une information commerciale. Une sélection est une proposition, pas une validation de conception.
