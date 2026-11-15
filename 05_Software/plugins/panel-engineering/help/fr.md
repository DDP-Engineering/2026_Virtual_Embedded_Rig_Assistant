# Ingénierie d'armoire

L'ingénierie d'armoire permet à l'agent de planifier et de vérifier une armoire de commande à côté du modèle électrique du projet. Vous décrivez l'enveloppe et la plaque de montage, les rails, les goulottes, les zones avec vos règles, les équipements, les borniers, l'alimentation 24 V, les scénarios, la réserve et les conditions thermiques dans un fichier d'armoire ; la vérification rapproche la liste des équipements des démarreurs des moteurs, du modèle et de vos schémas QElectroTech, place chaque appareil sur les rails avec ses vraies dimensions, établit le bilan de l'alimentation 24 V et estime la température de l'air dans l'enveloppe.

## Ce qu'il faut

- **Aucun programme.** L'agent utilise les outils intégrés de VERA `panel_engineering` et `panel_engineering_check`, proposés uniquement tant que ce plugin est activé. Il n'y a rien à installer ni à télécharger, donc **Installer les dépendances** n'a rien à faire ici.
- Un résultat de démarrage moteur à jour (plugin Motor starting and drives) et des catalogues industriels avec les dimensions, pertes et accessoires des appareils (plugin Industrial catalog and documented selection).
- En option, les schémas QElectroTech des moteurs (plugin QElectroTech schematics).

## Comment l'utiliser

- « Propose les équipements de l'armoire pour M1 et M2 à partir du dernier résultat moteur. » (skill `panel-engineering`)
- « Écris le fichier d'armoire de MCP1 : enveloppe 600 x 400 x 200 murale, trois rails, une alimentation 24 V pour l'automate. »
- « Vérifie l'armoire par rapport au résultat moteur et aux deux schémas. »
- « Quels appareils n'ont pas pu être placés, et pourquoi ? »
- « J'ai remplacé KM1-M1 - que dois-je refaire ? »
- « Exporte la nomenclature en CSV et l'implantation en SVG. »

Le résultat est enregistré dans `electrical-automation-results/<run-id>/` avec les hashs du fichier d'armoire, des catalogues et des schémas ; si le modèle change, il est marqué obsolète.

## Risques et approbations

`panel_engineering` ne fait que lire. `panel_engineering_check` est un outil d'écriture : il demande votre approbation comme une écriture de fichier et n'est pas proposé dans les sessions en lecture seule. Il n'écrit que son nouveau fichier de résultat ; le modèle, le fichier d'armoire, les catalogues et les schémas ne sont pas modifiés. Il n'y a aucune action de lecture ou d'écriture sur un appareil ni aucune action irréversible.

## Limites

- Un accessoire n'est considéré compatible que si le catalogue le liste pour son appareil hôte ; sinon il reste ouvert.
- Une dimension ou une perte manquante reste inconnue : l'appareil n'est pas placé et la dissipation n'est pas sommée, jamais comptée comme nulle.
- La température de l'air est le bilan thermique de l'enveloppe du catalogue d'enveloppes Schneider Electric (valeur moyenne, pertes aux valeurs assignées) ; le haut de l'enveloppe est plus chaud.
- La tenue au court-circuit demande la valeur assignée déclarée de l'ensemble ; les jeux de barres ne sont pas évalués.
- Aucune conformité CEI 61439 n'est déclarée, pas d'implantation 3D ni de données d'usinage. Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sur Ubuntu x64 natif.
- Les résultats sont une aide d'ingénierie préliminaire : pas de conception vérifiée ni de fonction de sécurité.
