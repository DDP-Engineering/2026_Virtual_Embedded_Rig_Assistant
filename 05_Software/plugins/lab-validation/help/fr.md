# Validation de mesures

Validation de mesures compare des captures de banc et des simulations à des exigences, hors ligne et de façon reproductible. L’agent écrit une requête JSON qui nomme les sources, les signaux, les fenêtres de mesure, l’alignement, les critères, la règle de décision et l’incertitude, et le programme fait le travail : il importe les données, normalise les unités et les signes, mesure la valeur efficace (RMS), la fréquence, le rapport cyclique, les temps de montée et de descente, le dépassement, l’établissement, l’ondulation et le retard, aligne les séries sur des marqueurs déclarés ou par corrélation croisée bornée, et décide de chaque critère : réussi, échoué ou incomplet. Le rapport, avec superpositions, écarts, conditions et liens vers les sources, va dans `embedded-lab-results/<run-id>/` du banc de travail.

## Prérequis

- **lab-validate** : un script reposant sur la bibliothèque standard Python, installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Les données dans le banc de travail : dossiers de capture scpi-instruments, fichiers CSV, exports CSV de sigrok-cli, ou dossiers d’exécution transitoire ngspice ou LTspice. Les plugins SPICE n’ont pas besoin d’être installés pour lire leurs dossiers d’exécution. Les formats propriétaires bruts (`.sr`, `.raw`, binaires d’oscilloscope) doivent d’abord être convertis avec leur propre outil.
- Les limites de l’exigence telles qu’elles sont rédigées, ainsi que l’incertitude et la bande passante d’instrument que vous pouvez justifier pour votre montage.
- Aucun plugin, matériel ni paramètre de configuration requis.

## Utilisation

- « Que contient la capture de embedded-lab-results/cap1 ? »
- « Vérifiez le temps de montée et l’ondulation de la capture d’oscilloscope par rapport à REQ-PWR-12. » (compétence `validation-planning`)
- « Comparez la sortie mesurée avec l’exécution ngspice, alignées sur le front montant de l’entrée. »
- « Pourquoi le critère C2 est-il incomplet ? » (compétence `difference-explanation`)
- « Résumez ces exécutions de comparaison en un verdict de campagne unique. »

L’agent ne calcule jamais lui-même une métrique ni un verdict et ne cite que ce que le programme rapporte. Il n’élargit pas une limite, une fenêtre ou une tolérance pour obtenir une réussite. Les écarts entre mesure et simulation sont proposés comme des hypothèses liées aux éléments du résultat.

## Risques et approbations

Toutes les commandes de ce plugin sont sûres et s’exécutent sans demander dans tous les modes d’autorisation, y compris Lecture seule. Il lit des fichiers du banc de travail sans les modifier, n’ouvre aucune connexion réseau, ne lance aucun autre programme et ne crée que de nouveaux dossiers d’exécution. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64.
- Un résultat n’est ni un étalonnage ni une certification métrologique ; lab-validate ne calcule pas l’incertitude.
- Les trous, l’écrêtage, un repliement de spectre manifeste, une bande passante inconnue ou insuffisante et des conditions manquantes ou différentes rendent un critère incomplet. Incomplet ne signifie pas presque réussi.
- Les horloges de différents instruments ne sont jamais synchronisées d’après les horodatages des fichiers ; l’alignement utilise des marqueurs, des décalages déclarés ou la corrélation croisée.
- Un verdict est aussi fiable que les dossiers de capture et d’exécution qu’il lit : leurs empreintes proviennent de leurs propres fichiers de résultat et rien n’est signé.
