# Réseau électrique et dimensionnement des câbles

Réseau électrique et dimensionnement des câbles permet à l’agent de calculer un réseau basse tension radial du modèle électrique du banc de travail au lieu de l’estimer. Il couvre le bilan de charge P/Q/S par scénario avec facteurs de simultanéité et d’utilisation, les courants de phase et de neutre, les courants d’emploi, les sections de câble vérifiées ou proposées d’après un tableau de câbles cité, la chute de tension monophasée et triphasée, ainsi que les courants de défaut maximaux et minimaux par la méthode des impédances selon la CEI 60909-0:2016. Chaque résultat indique sa méthode, ses entrées, ses unités, ses hypothèses et ses limites. Il fonctionne hors ligne et ne touche à aucun matériel.

## Prérequis

- Aucun programme et rien à installer : le plugin n’en a pas. L’agent utilise l’outil intégré `electrical_network` de VERA, proposé uniquement tant que le plugin est activé et jamais dans les sessions en Lecture seule.
- Un modèle électrique dans le banc de travail, `electrical-automation-model.json`, avec un transformateur ou un point d’alimentation BT, ses circuits, ses câbles et ses charges.
- Un tableau de câbles dans `electrical-automation-tables/` avec des valeurs citées. VERA ne fournit aucun tableau CEI 60364-5-52 ; saisissez des valeurs issues d’une datasheet ou d’une norme que vous possédez.
- Mode de pose, température ambiante, groupement et niveau de défaut. L’agent demande une valeur manquante au lieu de l’inventer.

## Utilisation

- « Calculez le bilan de charge du tableau principal en fonctionnement normal et pompe arrêtée. » (compétence `network-sizing`)
- « Vérifiez les sections de câble de tous les circuits avec ce tableau de câbles. »
- « Quelle section proposez-vous pour le câble du moteur M1, et quel critère décide ? »
- « Quelle est la chute de tension au bout du circuit le plus long, par rapport à une limite de 4 % ? »
- « Quels sont les courants de défaut maximal et minimal au tableau et aux extrémités des circuits ? »
- « Affichez à nouveau le résultat enregistré et dites-moi s’il est périmé. »

Un résultat est enregistré dans un nouveau `electrical-automation-results/<run-id>/result.json` avec ses entrées ; une modification ultérieure du modèle le marque donc comme périmé. Une section proposée n’est qu’une proposition ; l’adopter passe par une modification du modèle que vous approuvez.

## Risques et approbations

`electrical_network` écrit un seul nouveau fichier de résultat et demande une approbation comme une écriture de fichier. Il ne modifie jamais le modèle, un schéma ni une sélection approuvée ; modifier le modèle passe par `electrical_model_change`, qui demande aussi une approbation. Réafficher un résultat enregistré avec `electrical_model` est en lecture seule. Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 et WSL2 ; pas encore exécuté sous Ubuntu x64 natif.
- Un transformateur (Dyn pour les défauts à la terre) ou un point d’alimentation BT, courant alternatif triphasé jusqu’à 1000 V, alimentations radiales, un câble par circuit. Les réseaux maillés, les couplages de barres, les câbles en parallèle, les groupes électrogènes, les onduleurs, le PV et le courant continu ne sont pas évalués ou bloquent l’exécution.
- Les données manquantes restent inconnues et ne passent jamais ; les sources ou topologies non prises en charge ne sont pas évaluées. Les facteurs sont pris au point tabulé suivant, jamais interpolés.
- Les jeux d’essai sont petits et cités ; aucun tableau CEI ni catalogue complet de fabricant n’est fourni. Un tableau sans réactance exige une valeur supposée convenue, consignée comme hypothèse.
- Les résultats sont une aide d’ingénierie préliminaire, pas une conception vérifiée, une déclaration de conformité ni une certification de sécurité. Le choix des appareils de protection, les temps de coupure et la sélectivité relèvent de la coordination des protections.
