# Schémas QElectroTech

Schémas QElectroTech permet à l’agent de lire vos projets QElectroTech (.qet) et de les utiliser à côté du modèle électrique du projet. Il liste les folios, les appareils avec leurs contacts liés et leurs renvois, ainsi que les potentiels reliés par des conducteurs, et fait correspondre les appareils aux repères du modèle. Pour un moteur disposant d’un résultat de démarrage à jour, il propose un schéma sur deux folios (circuit de puissance et de commande) à partir du modèle démarrage direct, inverseur ou étoile-triangle et le vérifie avant votre approbation. Il renomme aussi des éléments dans un projet existant et enregistre une vérification de la numérotation, des renvois et de la liste des appareils.

## Ce qu’il faut

- **Aucun programme.** L’agent utilise les outils intégrés de VERA `qelectrotech`, `qelectrotech_change` et `qelectrotech_check`, proposés uniquement tant que ce plugin est activé. Il n’y a rien à installer ni à télécharger, donc **Install dependencies** n’a rien à faire ici.
- QElectroTech lui-même (testé avec 0.100 sous Windows et 0.90 sous Ubuntu) pour ouvrir, inspecter, numéroter et enregistrer les projets. VERA ne le lance jamais : QElectroTech n’a pas d’export en ligne de commande.
- Pour un candidat : un résultat de démarrage moteur à jour (plugin Démarrage des moteurs et variateurs) dont la méthode est direct, inverseur ou étoile-triangle.

## Comment l’utiliser

- « Lis schematics/plant.qet et liste ses folios et les éventuels problèmes. » (skill `qelectrotech-schematics`)
- « Quels contacts appartiennent à KM1, et sur quel folio et quelle colonne sont-ils ? »
- « Propose le schéma étoile-triangle de la pompe M2 à partir du dernier résultat moteur. »
- « Renomme KM1 en KM10 dans le projet que je viens d’enregistrer. »
- « Vérifie la numérotation et les renvois et compare la liste des appareils avec le modèle. »
- « Enregistre les appareils QElectroTech dans le modèle électrique. »

Les candidats sont de nouveaux fichiers. Un résultat de vérification est enregistré dans `electrical-automation-results/<run-id>/` avec le hash du fichier projet ; si le modèle change, il est marqué périmé.

## Risque et approbations

`qelectrotech` ne fait que lire. `qelectrotech_change` et `qelectrotech_check` sont des outils d’écriture : ils demandent votre approbation comme une écriture de fichier et ne sont pas proposés dans les sessions Read-only. Un candidat n’est jamais écrit sur un fichier existant ; une modification indique le hash du fichier lu et échoue si le fichier a changé entre-temps, de sorte que rien de ce que vous avez enregistré dans QElectroTech n’est écrasé. Seuls les textes modifiés changent ; tous les autres octets restent. Le modèle électrique n’est modifié que par l’outil du modèle, avec votre approbation. Il n’y a aucune action device-read, device-write ou irréversible.

## Limites

- Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Les fichiers contenant une déclaration de type de document ou des entités sont refusés (protection contre les entités XML externes).
- Un verrouillage électrique ne compte que comme contact NF sur chaque chemin vers la bobine ; un verrouillage mécanique provient du résultat de démarrage, jamais du dessin. Les modèles pour démarreur progressif et variateur ne font pas partie de cette version.
- L’alimentation de commande, les boutons et le relais temporisé des modèles sont des propositions que vous confirmez. La numérotation des conducteurs reste ouverte tant que vous ne les numérotez pas dans QElectroTech.
- Aucun PDF ni aucune image n’est converti en schéma.
- Les résultats sont une aide à l’ingénierie préliminaire : pas de conception vérifiée, pas de déclaration de conformité, et aucune fonction de sécurité n’est revendiquée.
