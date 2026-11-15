# Calculs électroniques

Calculs électroniques fournit à l’agent une calculatrice pour les valeurs sur lesquelles repose une décision de conception, afin qu’il effectue le calcul au lieu de l’estimer. Elle couvre la loi d’Ohm, les résistances en série, en parallèle et de shunt, les ponts diviseurs, les constantes de temps RC, les filtres et les formes d’onde, les pertes dans les régulateurs linéaires, les résistances, les MOSFET, les diodes, les condensateurs et les inductances, les bilans de puissance, les températures de jonction, de boîtier et de dissipateur, les réseaux de Foster transitoires, ainsi que l’analyse de tolérances au pire cas et par Monte Carlo. Chaque résultat indique ses unités, ses formules, ses hypothèses, ses limites et ses contrôles. Elle fonctionne hors ligne et ne touche à aucun matériel.

## Prérequis

- **elec-calc** : un script reposant sur la bibliothèque standard Python, installé automatiquement par **Installer les dépendances** sur la page du plugin. Rien n’est téléchargé.
- Les valeurs d’entrée avec leurs unités, idéalement avec la source dans la datasheet et les conditions de chacune. L’agent demande une valeur manquante au lieu de l’inventer, de la lire sur une courbe ou de l’extrapoler à d’autres conditions.
- Aucun plugin, matériel ni configuration requis.

## Utilisation

- « Quelle résistance haute donne 3,3 V à partir de 5 V avec une résistance basse de 10 kΩ ? » (compétence `electronics-sizing`)
- « Combien le LDO dissipe-t-il avec 12 V en entrée, 3,3 V en sortie, 300 mA et un courant de repos de 5 mA ? »
- « La jonction du régulateur restera-t-elle sous 125 °C à 40 °C ambiants avec un thetaJA de 50 K/W sur une carte JEDEC 2s2p ? » (compétence `thermal-analysis`)
- « Quel dissipateur me faut-il pour 10 W à 50 °C ambiants ? »
- « Vérifiez la sortie du pont diviseur avec des résistances à 1 % et une entrée de 4,9 à 5,1 V, au pire cas et par Monte Carlo. »
- « Enregistrez ces calculs de l’étage de puissance dans un rapport. »

Un rapport va dans `electronics-results/<run-id>/` du banc de travail sous forme de `report.json` et `report.md` ; il n’écrase jamais une exécution existante.

## Risques et approbations

Toutes les commandes de ce plugin sont sûres et s’exécutent sans demander dans tous les modes d’autorisation, y compris Lecture seule. Les calculs lisent leur requête et ne modifient aucun fichier ; seul `report` crée un nouveau dossier de résultats dans le banc de travail. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 ; pas encore exécuté sous Ubuntu x64 natif.
- L’analyse de tolérances accepte jusqu’à 6 sorties, 12 paramètres et 100 000 tirages Monte Carlo ; une grosse exécution peut prendre environ une minute. L’analyse des extrêmes ne trouve les extrêmes que là où une sortie est monotone par rapport à chaque paramètre, et le résultat indique où ce n’est pas le cas.
- thetaJA n’est jamais combiné avec des résistances jonction-boîtier ; il décrit déjà tout le chemin sur sa carte de test (voir https://www.ti.com/lit/an/spra953d/spra953d.pdf).
- Pas de certification thermique, de CFD ni de FEM, de réseaux de Cauer, de superposition thermique d’impulsions répétitives, d’estimation des pertes dans les noyaux magnétiques ni de dimensionnement d’isolement.
