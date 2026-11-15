# Démarrage des moteurs et variateurs

Démarrage des moteurs et variateurs permet à l’agent de comparer la façon dont chaque moteur de votre modèle électrique peut être démarré ou piloté, et de dimensionner ce qu’il faut, au lieu de choisir selon la seule puissance. Pour chaque moteur, il compare le démarrage direct, l’inversion de sens, l’étoile-triangle, le démarreur progressif et le variateur de vitesse avec la fonction du procédé, la limite du courant de démarrage, le couple d’accélération, le temps d’accélération et le nombre de démarrages par heure. Il propose la méthode la plus simple qui convient, dimensionne les contacteurs par catégorie d’emploi, le relais de surcharge, un démarreur progressif ou un variateur selon le courant et la surcharge avec déclassement cité, et fournit un schéma logique de raccordement et de verrouillage. Chaque résultat indique ses sources, unités, hypothèses et limites.

## Prérequis

- **Aucun programme.** L’agent utilise l’outil intégré de VERA `motor_drives`, proposé uniquement tant que ce plugin est activé. Il n’y a rien à installer ni à télécharger, donc **Installer les dépendances** n’a rien à faire ici.
- Un résultat de protection et coordination à jour (compétence `protection-selection`), qui exige lui-même un résultat de réseau électrique à jour ; les résultats périmés sont refusés.
- Le catalogue industriel avec contacteurs, relais de surcharge, démarreurs progressifs et variateurs, avec valeurs et conditions citées.
- Les données du moteur et de la charge dans le modèle (plaque signalétique, rapports de couple, inerties, couple résistant, démarrages par heure) ainsi que la fonction du procédé et les limites convenues avec l’agent. Les valeurs manquantes restent inconnues ; l’agent pose la question au lieu d’utiliser une valeur typique.

## Utilisation

- « Comparez DOL, étoile-triangle et un variateur pour le moteur de pompe M2. » (compétence `motor-starting`)
- « L’étoile-triangle est-il admis pour ce moteur, et le courant de démarrage en ligne reste-t-il sous la limite du distributeur ? »
- « Combien de temps le convoyeur met-il à accélérer, et est-ce inférieur au temps de rotor bloqué ? »
- « Dimensionnez les contacteurs et le relais de surcharge pour la méthode proposée. »
- « Quelle classe de service du variateur couvre le courant continu et de surcharge, avec déclassement à 45 °C et 1000 m ? »
- « Donnez-moi le schéma de raccordement et de verrouillage du démarreur inverseur. »

Le résultat est enregistré avec des copies des moteurs, circuits et câbles lus dans `electrical-automation-results/<run-id>/` du banc de travail. Si le modèle change ensuite, le résultat est marqué périmé.

## Risques et approbations

L’outil est un outil d’écriture : il enregistre un nouveau résultat et demande votre approbation comme pour une écriture de fichier. Il n’est pas proposé en mode Lecture seule. Il ne modifie jamais le modèle électrique et ne configure ni ne paramètre jamais un variateur, un démarreur progressif ou un relais. Il n’y a aucune action de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Le temps d’accélération et les courbes de couple sont des valeurs de modèle avec hypothèses indiquées, pas des performances garanties.
- Les données manquantes restent inconnues et ne valident jamais. L’énergie de freinage, la catégorie CEM, la longueur du câble moteur et les types de différentiel ne comptent qu’à partir de données citées ; le reste est une question pour le fabricant. Les démarrages par heure des démarreurs progressifs, la catégorie CEM d’un variateur et la longueur maximale du câble moteur manquent souvent sur les pages publiques.
- Les verdicts sur l’appareil de protection et la coordination des démarreurs sont repris du résultat de protection, jamais déduits du recouvrement des courbes.
- Les fixtures sont petites et citées ; les tableaux de fabricant sous licence ne sont pas fournis.
- Les résultats sont une aide d’ingénierie préliminaire : aucune conception vérifiée, déclaration de conformité ni fonction de sécurité n’est revendiquée. Le schéma est un point de départ logique pour les dessins.
