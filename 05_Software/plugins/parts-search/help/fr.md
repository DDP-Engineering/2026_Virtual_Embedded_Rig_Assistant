# Recherche et sélection de composants

Ce plugin aide l’agent à choisir des composants électroniques sur des preuves. L’agent cherche dans les catalogues des distributeurs que vous activez (Mouser, DigiKey, TME, Farnell, Rutronik), confirme les valeurs critiques dans la datasheet du fabricant avec la page et les conditions de test, et compare les candidats d’abord aux contraintes impératives, ensuite aux préférences. Il écrit une comparaison et une proposition de nomenclature (BOM) dans un nouveau dossier sous `electronics-results/`. Rien n’est commandé, et aucun schéma ni aucune BOM de projet n’est modifié.

## Prérequis

- **parts-compare**, un script Python du plugin, que VERA installe lui-même avec **Installer les dépendances**. Il compare hors ligne.
- Les **identifiants des distributeurs** (`supplier-keys`) : l’identifiant d’API de chaque distributeur dans lequel vous voulez chercher, avec la région qu’utilisent les recherches. Définissez-les dans la section **Configuration** de la page du plugin : Mouser (clé d’API), DigiKey (ID client et secret client), TME (jeton d’API et secret d’application), Farnell (clé d’API et boutique) et Rutronik (clé d’API fournie par votre contact Rutronik). Les identifiants restent sur votre ordinateur et ne sont jamais montrés à l’agent.
- L’**Accès web** activé dans **Paramètres**, et le plugin activé pour le banc de travail. La recherche n’est proposée que si les deux sont actifs et qu’au moins un distributeur est activé.
- Aucun matériel et aucun autre plugin.

## Utilisation

L’agent utilise la compétence `component-selection` pour la démarche et `component-families` pour les contrôles propres à chaque famille de composants (MOSFET, régulateurs, amplificateurs opérationnels, résistances, condensateurs, diodes, inductances). Il convient avec vous des contraintes impératives et des préférences avant de chercher.

- « Trouvez un MOSFET canal N en SOT-23 qui commute 5 A sous 24 V avec une commande de grille en 3,3 V. »
- « Recherchez BSS806NE chez les distributeurs activés et montrez les offres. »
- « Comparez ces trois LDO pour 3,3 V à 300 mA à partir de 5 V, du moins cher au plus cher, pour 500 pièces en EUR. »
- « Ce MLCC fait-il toujours 10 µF sous une polarisation DC de 12 V ? Vérifiez la datasheet. »
- « Proposez un remplaçant direct pour le régulateur de la carte. »

## Risques et approbations

La comparaison des candidats est classée **Sûr** : elle s’exécute hors ligne sur votre ordinateur, n’ouvre aucune connexion réseau, n’écrase jamais rien et s’exécute sans demander. Une recherche chez les distributeurs n’envoie que le texte recherché ou la référence aux distributeurs que vous avez activés.

## Limites

- Windows x64 et Linux x64.
- Chaque recherche se fait en direct et VERA n’enregistre aucun résultat de distributeur. Les offres sont un instantané, hors taxes et frais de port.
- Les paramètres des distributeurs restent non confirmés tant qu’ils n’ont pas été vérifiés dans la datasheet. Les valeurs lues sur des courbes ou des pages numérisées doivent être confirmées par vous.
- Données TME : powered by TME.eu Data ; aucune garantie quant à l’exactitude des données.
