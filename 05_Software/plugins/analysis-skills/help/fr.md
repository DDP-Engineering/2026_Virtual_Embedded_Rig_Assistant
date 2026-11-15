# Compétences d’analyse

Le plugin Compétences d’analyse donne à l’agent deux procédures pour travailler sur des éléments que vous avez déjà capturés. La compétence `firmware-comparator` compare une exécution de firmware de référence et une exécution candidate à partir de leurs journaux, des conditions d’exécution documentées, des notes de version et d’un critère d’acceptation, puis enregistre un rapport de comparaison sourcé dans la session. La compétence `test-planner` transforme une modification de firmware, une défaillance capturée ou un objectif en un à cinq cas de test manuels, avec préparation, étapes et critères d’acceptation sourcés ainsi qu’un tableau de résultats, et enregistre le plan dans la session. Aucune des deux compétences ne flashe, ne capture, ne compile ni n’exécute de test.

## Prérequis

- Aucun programme et aucune configuration : le plugin ajoute seulement des compétences.
- Des journaux capturés dans le banc de travail (par exemple sous `logs/`), des notes d’exécution comme `docs/runs.md` ou `WORKBENCH.md`, et les documents de critères et de notes de version que la comparaison ou le plan doit citer. Les documents indexés rendent les notes de version consultables par recherche ; sans indexation, l’agent lit directement les fichiers.
- Facultatif : pour comparer deux builds par taille ou par symboles, les deux dossiers de build et un plugin activé disposant d’une commande sûre de taille ou de symboles, par exemple esp32-idf (`idf.py size`).

## Utilisation

- « Comparez les journaux de démarrage des firmwares 1.0.0 et 1.1.0 sur la carte rév. B au critère de démarrage de docs/boot-test.md. »
- « Lesquelles de ces exécutions diffèrent, et qu’est-ce qui a changé entre elles ? Demandez-moi si plusieurs exécutions correspondent. »
- « Planifiez jusqu’à trois tests manuels pour la modification du timing I2C de la version 1.1.0. »
- « Transformez le rapport de comparaison en plan de test avec un contrôle de référence. »

Quand plusieurs exécutions correspondent, l’agent vous demande de choisir ; il ne prend jamais la plus récente sans le dire. Une carte, une révision, une préparation ou un critère manquant laisse le rapport ou le plan marqué comme bloqué, et l’agent vous demande les informations manquantes. Une limite numérique qu’aucune source n’indique n’est jamais inventée.

## Risques et approbations

Le plugin ne déclare aucune règle et n’exécute aucun programme qui lui soit propre. Un plan de test peut nommer une commande d’un autre plugin activé, comme `esptool write-flash` (écriture appareil), mais seulement comme étape facultative que vous pouvez demander séparément. La comparaison de taille facultative n’utilise qu’une commande sûre de l’autre plugin, qui s’exécute sans demander.

## Limites

- Windows x64 et Linux x64.
- Une comparaison établit ce que montrent les captures, pas pourquoi : des notes identiques ne prouvent pas que le banc était identique, et la comparabilité n’est pas une aptitude à la mise en production.
- Un plan n’est qu’une préparation ; les résultats restent en attente jusqu’à ce que vous fournissiez des mesures.
