# Qualité de l’énergie et compensation réactive

Qualité de l’énergie et compensation réactive fournit à l’agent l’outil intégré `power_quality` de VERA pour la compensation de l’énergie réactive à un tableau. Il importe des fichiers de mesures P/Q/S et d’harmoniques dans un format déclaré et donne, par scénario de réseau et par intervalle mesuré, la puissance active et la puissance réactive fondamentale, le facteur de déplacement et le facteur de puissance total en présence de distorsion, les kvar nécessaires pour atteindre une cible, une batterie fixe ou automatique de gradins égaux avec une proposition de logique de commande, la surcompensation à faible charge, des contrôles du condensateur, de la self anti-harmonique, du contacteur et de la protection de gradin par rapport à des données de catalogue citées, ainsi que la résonance parallèle par rapport aux rangs d’harmoniques mesurés. Chaque résultat indique ses sources, ses unités, ses hypothèses et ses limites. Il propose ; il ne commute jamais un gradin et ne règle aucun régulateur.

## Prérequis

- Aucun programme : le plugin apporte une compétence, et l’agent utilise l’outil intégré de VERA, proposé uniquement tant que le plugin est activé. Il n’y a rien à installer.
- Le tableau dans le modèle électrique du projet, idéalement avec un résultat de réseau à jour (compétence `network-sizing`), qui donne P et Q du tableau par scénario et son niveau de court-circuit pour le contrôle de résonance.
- Un fichier de mesures avec temps, unités et conventions de signe déclarés. Si l’export ne précise pas si Q est fondamentale ni son signe, vous énoncez l’hypothèse ; l’agent ne la devine jamais.
- La cible et les limites que vous seul pouvez fixer : facteur de puissance cible, tolérance de tension, marge de résonance, sorties du régulateur. Des données de catalogue citées (condensateurs, selfs, contacteurs, protection) pour les contrôles d’équipement.

## Utilisation

- « Importez cet export d’analyseur pour le tableau principal et montrez le facteur de déplacement et le facteur de puissance total. » (compétence `power-factor-correction`)
- « Combien de kvar me faut-il pour atteindre 0,95 à ce tableau, dans chaque scénario ? »
- « Proposez une batterie fixe ou automatique et expliquez pourquoi, y compris la surcompensation à la charge la plus faible. »
- « Vérifiez ces condensateurs, selfs et contacteurs par rapport au catalogue. »
- « La batterie entre-t-elle en résonance près d’un rang d’harmonique mesuré avec un niveau de court-circuit de 20 MVA ? »
- « Traitez le Q de ce fichier comme fondamental et notez cette hypothèse dans le résultat. »

Les fichiers de mesures vont dans `electrical-automation-measurements/` et chaque résultat dans `electrical-automation-results/<run-id>/` ; un résultat n’écrase jamais un précédent et est marqué périmé quand le modèle change.

## Risques et approbations

L’outil écrit : il n’est pas proposé dans les sessions en Lecture seule, et VERA demande avant d’enregistrer un résultat ou un fichier de mesures, comme pour toute écriture de fichier. Il ne modifie pas le modèle, ne commute aucun gradin de condensateurs et ne règle aucun régulateur. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Aide d’ingénierie préliminaire : pas de conception vérifiée, pas de déclaration de conformité et pas de rapport complet de qualité de l’énergie. Les condensateurs ne corrigent que la part de déplacement.
- Les données manquantes restent inconnues et ne passent jamais : sans niveau de court-circuit, marge ou données d’harmoniques, le verdict de résonance est inconnu, et un couple condensateur-self n’est accepté que depuis un tableau cité.
- Pas de conception de filtre ni de transitoires de commutation. La résonance est contrôlée au niveau de court-circuit maximal et, quand le résultat de réseau le contient, au niveau minimal.
