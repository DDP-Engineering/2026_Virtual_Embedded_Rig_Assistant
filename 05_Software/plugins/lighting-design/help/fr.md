# Conception d’éclairage

Conception d’éclairage fournit à l’agent l’outil intégré `lighting_design` de VERA pour l’éclairage intérieur d’un local rectangulaire. Le niveau préliminaire lit une photométrie IES LM-63 ou EULUMDAT et donne une estimation par la méthode du flux utile avec des facteurs d’utilisation cités, les luminaires nécessaires, la puissance installée et la composante directe sur la grille de calcul, avec des diagnostics pour une unité de longueur, une échelle, une orientation ou une photométrie erronées. Le niveau de vérification contrôle un rapport DIALux evo que vous exportez pour le même local et ne donne qu’ensuite des verdicts sur l’éclairement maintenu, l’uniformité et l’éblouissement. Chaque résultat indique ses sources, ses unités, ses hypothèses et ses limites. VERA n’écrit aucun fichier DIALux et n’exécute pas DIALux.

## Prérequis

- Aucun programme : le plugin apporte une compétence, et l’agent utilise l’outil intégré de VERA, proposé uniquement tant que le plugin est activé. Il n’y a rien à installer.
- Un projet d’éclairage que l’agent rédige avec vous : l’unité de longueur déclarée, le local, les réflectances, le plan de calcul, le facteur de maintenance avec sa source, les types de luminaires, leurs positions et orientations, ainsi que les exigences que vous saisissez à partir de la norme applicable, avec leur source.
- Les fichiers `.ies` ou `.ldt` du fabricant, non modifiés, et les facteurs d’utilisation issus du tableau du fabricant. L’agent demande d’où viennent les fichiers et n’en télécharge jamais sans votre accord.
- Pour la vérification : DIALux evo sous Windows, où vous construisez le même local à partir des valeurs du projet et des mêmes fichiers de photométrie, calculez et exportez le rapport.

## Utilisation

- « Rédigez un projet d’éclairage pour ce bureau de 8 sur 6 m à partir de ces fichiers IES et vérifiez le résultat préliminaire. » (compétence `lighting-design`)
- « Combien de ces luminaires me faut-il pour 500 lx maintenus ? »
- « Pourquoi la composante directe paraît-elle si faible ? Vérifiez les diagnostics d’unité, d’inclinaison et de rotation. »
- « Comparez le flux et la puissance du catalogue avec ce que dit le fichier de photométrie. »
- « Guidez-moi dans les étapes de DIALux evo pour reconstruire ce local. »
- « Vérifiez le rapport DIALux exporté par rapport au projet, puis donnez les verdicts d’uniformité et d’éblouissement. »

Les fichiers de projet, de photométrie et de rapport vont dans `electrical-automation-lighting/` et `electrical-automation-photometry/` ; chaque résultat va dans `electrical-automation-results/<run-id>/` et n’écrase jamais un précédent.

## Risques et approbations

L’outil écrit : il n’est pas proposé dans les sessions en Lecture seule, et VERA demande avant d’enregistrer un résultat ou un fichier de projet, comme pour toute écriture de fichier. Il ne modifie aucun autre fichier et ne lance aucun programme. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Le niveau préliminaire est une estimation, jamais un verdict photométrique détaillé : l’éclairement maintenu, l’uniformité et l’UGR restent non évalués tant qu’un rapport de moteur correspondant n’est pas vérifié. VERA ne calcule pas elle-même l’uniformité ni l’UGR.
- Les données manquantes restent inconnues et ne passent jamais. Un rapport qui ne correspond pas au projet est rejeté ; on corrige le modèle dans DIALux, jamais l’enregistrement.
- L’éclairage de sécurité et l’éclairage extérieur ne sont pas pris en charge dans cette version. La photométrie doit être IES LM-63 de type C ou EULUMDAT ; les autres fichiers sont refusés avec le motif.
