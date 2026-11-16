# Échange EPLAN

L'échange EPLAN permet à l'agent de comparer votre projet EPLAN Electric P8 2025 à la documentation électrique de VERA et de renvoyer à EPLAN des références approuvées. Il lit la liste d'appareils et les tables de bornes et de connexions exportées par EPLAN, montre ce qui diffère des listes de documentation, prépare un fichier de liste d'appareils à importer et le fait importer dans une copie de votre projet, jamais dans l'original. Une vérification montre ensuite si chaque valeur est arrivée et si rien d'autre n'a changé.

**Pas encore vérifié avec une vraie installation EPLAN.** Il suit la documentation publique de l'API EPLAN ; essayez-le d'abord sur une copie d'un projet de test.

## Ce qu'il faut

- Votre propre EPLAN Electric P8 2025 sous licence, sous Windows, installé dans son dossier par défaut (Program Files\EPLAN\Platform\2025...). VERA n'installe ni ne fournit rien d'EPLAN.
- Le programme **eplan-tool** de ce plugin (un petit script Python) : utilisez **Install dependencies** sur la page du plugin.
- Un fichier de profil dans `electrical-automation-eplan/` qui nomme votre fichier de projet (.elk, chemin sans espaces) et les en-têtes de colonnes de vos exports EPLAN. Pour les bornes et les connexions, un schéma d'export EPLAN (« édition externe ») qui écrit du texte séparé par des points-virgules avec une ligne d'en-tête.
- Une exécution de documentation électrique à jour (plugin Documentation électrique) pour la comparaison.

## Comment l'utiliser

- « Écris un profil EPLAN pour C:\EPLAN\Projects\PlantM.elk avec ces en-têtes de colonnes. » (skill `eplan-exchange`)
- « Exporte d'EPLAN la liste d'appareils et les tables de bornes et de connexions. »
- « Compare l'export EPLAN à la dernière exécution de documentation. »
- « Prépare un fichier d'import qui corrige les références dans EPLAN. »
- « Importe-le dans une copie du projet et vérifie que tout est arrivé. »

## Risques et approbations

`eplan` ne fait que lire. `eplan_change` et `eplan_check` sont des outils d'écriture : ils demandent votre approbation comme une écriture de fichier et ne sont pas proposés dans les sessions en lecture seule. **eplan-tool export** est une action de lecture d'appareil : elle démarre EPLAN avec votre projet ouvert en lecture seule. **eplan-tool import** est une action d'écriture d'appareil : elle crée une nouvelle copie de votre projet et y importe le fichier approuvé ; votre projet d'origine n'est pas modifié. Chaque commande EPLAN nomme son projet ; rien n'est attaché à un EPLAN que vous avez ouvert et aucun script d'un projet n'est exécuté. Un import échoué, refusé ou arrêté n'est jamais signalé comme appliqué.

## Limites

- Windows x64 uniquement. Pas encore exécuté avec un vrai EPLAN : la structure des fichiers, les codes de sortie, les messages de licence et le comportement avec un projet ouvert ailleurs ne sont pas confirmés.
- Seule la liste d'appareils (références et colonne ID VERA) est importée. Les connexions, les bornes et les macros sont comparées mais jamais importées ; les macros ne sont pas du tout traitées.
- Les chemins transmis à EPLAN ne doivent contenir ni espaces ni guillemets.
- Les résultats sont une aide d'ingénierie préliminaire : ni conception vérifiée ni déclaration de conformité.
