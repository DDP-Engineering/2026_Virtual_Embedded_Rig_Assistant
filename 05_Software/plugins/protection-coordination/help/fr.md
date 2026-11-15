# Protection et coordination

Protection et coordination permet à l’agent de vérifier des fusibles et des disjoncteurs candidats pour les circuits de votre modèle électrique, au lieu de les juger à l’œil. Pour chaque candidat, il contrôle la tension assignée, les pôles, le pouvoir de coupure du type que nomme le profil (Icu, Ics ou Icn), Ib <= In <= Iz, I2 <= 1,45 Iz, la coupure automatique à partir de bandes de déclenchement citées, l’énergie traversante par rapport à k²S² ainsi que le type et la sensibilité du différentiel. La sélectivité, la filiation et la coordination des démarreurs viennent uniquement des tableaux du fabricant pour exactement ces produits. Chaque résultat indique ses sources, unités, conditions et limites.

## Prérequis

- **Aucun programme.** L’agent utilise l’outil intégré de VERA `protection_coordination`, proposé uniquement tant que ce plugin est activé. Il n’y a rien à installer ni à télécharger, donc **Installer les dépendances** n’a rien à faire ici.
- Un résultat de réseau électrique à jour pour le projet (compétence `network-sizing`) ; un résultat périmé est refusé.
- Le catalogue industriel contenant les fusibles et disjoncteurs candidats, sous forme d’articles avec valeurs et conditions citées.
- Des valeurs de profil convenues avec l’agent : le type de pouvoir de coupure, les temps de coupure et la sensibilité du différentiel. L’agent ne les choisit pas lui-même.

## Utilisation

- « Lequel de ces deux disjoncteurs peut protéger le circuit Q3 face au courant de défaut à son origine ? » (compétence `protection-selection`)
- « Vérifiez le fusible gG de 16 A par rapport à l’Iz du câble et au temps de coupure en bout de circuit. »
- « L’énergie traversante du disjoncteur reste-t-elle sous k²S² pour ce câble ? »
- « Le type de différentiel est-il admis par la notice du variateur et la sensibilité respecte-t-elle la limite du profil ? »
- « Le disjoncteur est-il sélectif avec le fusible amont ? Utilisez le tableau du fabricant. »
- « Pourquoi la coordination du démarreur est-elle inconnue, et quelles données la lèveraient ? »

Le résultat est enregistré avec ses entrées dans `electrical-automation-results/<run-id>/` du banc de travail. Si le modèle change ensuite, le résultat est marqué périmé.

## Risques et approbations

L’outil est un outil d’écriture : il enregistre un nouveau résultat et demande votre approbation comme pour une écriture de fichier. Il n’est pas proposé en mode Lecture seule. Il ne modifie jamais le modèle électrique, ne configure aucun appareil et n’écrit aucun réglage de relais ou de disjoncteur. Il n’y a aucune action de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- La sélectivité, la filiation et la coordination de type 1 / type 2 ne sont jamais déduites du recouvrement des courbes. Sans tableau du fabricant pour exactement ces produits et conditions, la paire n’est pas évaluée.
- Les données manquantes restent inconnues et ne valident jamais : une valeur de catalogue extraite, absente ou hors conditions, une courbe sans bande ou un courant de déclenchement magnétique sans tolérance ni temps de fonctionnement laisse le critère ouvert. Icu, Ics et Icn ne se substituent jamais l’un à l’autre.
- Les fixtures sont petites et citées ; les tableaux de fabricant sous licence ne sont pas fournis. Les tableaux publics avec courant présumé, temps de fonctionnement instantanés numériques, fenêtres temps-courant des fusibles et I²t sont souvent réservés au téléchargement ou à la licence, donc ces critères restent ouverts jusqu’à ce que vous les fournissiez.
- Les résultats sont une aide d’ingénierie préliminaire : pas de conception vérifiée, pas de déclaration de conformité et pas de fonction de sécurité.
