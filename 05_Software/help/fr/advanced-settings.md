# Paramètres avancés

Les paramètres avancés règlent des limites que la plupart des utilisateurs n’ont jamais besoin de modifier. Ils sont masqués jusqu’à ce que vous activiez **Afficher les paramètres avancés** dans **Paramètres** → **Avancé**. Désactiver l’interrupteur ne fait que les masquer : les valeurs déjà définies continuent de s’appliquer.

Dans les paramètres de l’application, ouvrez un groupe pour afficher ses réglages. **Valeurs modifiées uniquement** affiche les valeurs personnalisées enregistrées et les modifications en cours, y compris les réinitialisations.

## Où les trouver

- **Paramètres** → **Avancé** : valeurs pour toute l’application.
- **Modifier le banc** → **Avancé** : valeurs pour un banc de travail, enregistrées avec le banc. Elles sont conservées dans `.vera/workbench.yaml`.
- Le menu de la session (**…** à côté d’une session) → **Paramètres avancés** : valeurs pour une seule conversation. **Enregistrer** les conserve avec la session, et elles survivent à un redémarrage ; **Annuler** ferme sans modification.

## Quelle valeur s’applique

Une valeur de session l’emporte sur une valeur de banc, qui l’emporte sur la valeur de l’application, qui l’emporte sur la valeur par défaut. Un champ vide hérite ; il affiche la valeur héritée et sa provenance, par exemple « 200 (par défaut) ». **Réinitialiser** efface la valeur à ce niveau. Une valeur de banc ou de session peut être plus haute ou plus basse que celle de l’application.

Une valeur hors de la plage d’un paramètre est refusée à la saisie. Une valeur modifiée à la main dans un fichier et hors plage est ignorée, et le niveau suivant s’applique.

## Quand une modification s’applique

L’icône à côté de chaque paramètre indique quand une modification prend effet : immédiatement, au prochain terminal, worker, exécution ou session ouverte, après la réindexation, après la réouverture du banc ou après le redémarrage de VERA.

## Paramètres

Chaque paramètre n’apparaît qu’aux niveaux indiqués. Un interrupteur propose **Hériter**, **Activé** et **Désactivé** ; **Hériter** affiche l’état hérité, par exemple « Activé (par défaut) ». **Lignes par page** propose **Hériter**, 10, 20 et 50.

| Paramètre | Niveaux | Plage | Par défaut | S’applique |
|---|---|---|---|---|
| Appels d’outils par tour | application, banc, session | 10–500 | 200 | Immédiatement |
| Délai sans sortie du modèle (s) | application, session | 30–3600 | 300 | Immédiatement |
| Attente des en-têtes des fournisseurs hébergés (s) | application | 10–300 | 30 | Immédiatement |
| Délai de détection des modèles (s) | application | 5–120 | 10 | À la prochaine opération |
| Compactage en arrière-plan | application, banc | Activé / Désactivé | Activé | Immédiatement |
| Seuil de compactage (%) | application, banc | 50–95 | 80 | Immédiatement |
| Historique récent conservé tel quel (jetons) | application, banc | 0–100000 | 20000 | Immédiatement |
| Taille des résultats d’outils dans les résumés (caractères) | application | 500–8000 | 2000 | Immédiatement |
| Passes de résumé par requête | application | 1–10 | 5 | Immédiatement |
| Marge de calibrage (%) | application | 100–150 | 110 | Immédiatement |
| Utiliser le décompte de jetons du fournisseur | application | Activé / Désactivé | Activé | Immédiatement |
| Sessions déléguées par banc de travail | application | 1–8 | 3 | Immédiatement |
| Tours simultanés | application | 1–16 | 4 | Immédiatement |
| Compactage automatique | session | Activé / Désactivé | Activé | Immédiatement |
| Taille d’un résultat d’outil (caractères) | application | 8000–128000 | 32000 | Immédiatement |
| Fenêtre de lecture (lignes) | application | 500–10000 | 2000 | Immédiatement |
| Taille de lecture (caractères) | application | 10000–120000 | 30000 | Immédiatement |
| Résultats grep | application | 50–2000 | 500 | Immédiatement |
| Taille de fichier pour grep (Mio) | application | 1–50 | 5 | Immédiatement |
| Résultats glob | application | 100–5000 | 500 | Immédiatement |
| Délai des workers (s) | application | 5–120 | 10 | Au prochain terminal, worker, exécution ou session ouverte |
| Résultats de recherche web | application | 1–8 | 5 | Immédiatement |
| Taille de lecture web (caractères) | application | 1000–16000 | 12000 | Immédiatement |
| Délai des requêtes web (s) | application | 5–120 | 30 | Immédiatement |
| Délai de navigation du navigateur (s) | application | 5–60 | Automatique | À la prochaine opération |
| Taille de téléchargement (Mio) | application | 10–1000 | 100 | Immédiatement |
| Durée limite d’un téléchargement (s) | application | 30–1800 | 120 | Immédiatement |
| Programmes en arrière-plan par session | application | 1–16 | 4 | Au prochain terminal, worker, exécution ou session ouverte |
| Journaux d’exécution conservés | application | 20–2000 | 200 | Immédiatement |
| Taille d’un journal d’exécution (Mio) | application | 8–1024 | 64 | Immédiatement |
| Délai par défaut des programmes (s) | application, banc | 60–3600 | 600 | Immédiatement |
| Plafond de durée des commandes shell (s) | application, banc | 60–3600 | 600 | Immédiatement |
| Taille maximale des fichiers texte (Mio) | banc | 1–64 | 20 | Après la réindexation |
| Avertissement de volume : fichiers | application, banc | 500–100000 | 2000 | Immédiatement |
| Avertissement de volume : taille (Mio) | application, banc | 512–51200 | 2048 | Immédiatement |
| Résultats du panneau Docs | application, banc | 10–100 | 20 | Immédiatement |
| Durée limite d’extraction des documents (s) | application | 30–1800 | 120 | Au prochain terminal, worker, exécution ou session ouverte |
| Pause d’indexation (ms) | application | 250–10000 | 1000 | Immédiatement |
| Inactivité du worker d’embedding (s) | application | 10–600 | 60 | Au prochain terminal, worker, exécution ou session ouverte |
| Délai de transcription (s) | application | 30–300 | 120 | À la prochaine opération |
| Terminaux par banc | application | 1–16 | 8 | Au prochain terminal, worker, exécution ou session ouverte |
| Mémoire du terminal (Ki caractères) | application | 64–1024 | 256 | Au prochain terminal, worker, exécution ou session ouverte |
| Historique du terminal (lignes) | application | 1000–50000 | 3000 | Au prochain terminal, worker, exécution ou session ouverte |
| Sortie du terminal pour l’agent (caractères) | application | 2000–64000 | 12000 | Immédiatement |
| Intervalle de vérification des mises à jour (h) | application | 1–168 | 6 | Immédiatement |
| Intervalle de vérification du catalogue de plugins (h) | application | 1–168 | 24 | Immédiatement |
| Conservation des journaux (jours) | application | 1–90 | 7 | Immédiatement |
| Lignes de conversation affichées d’abord | application | 20–200 | 40 | Au prochain terminal, worker, exécution ou session ouverte |
| Lignes de conversation par chargement | application | 50–500 | 100 | Au prochain terminal, worker, exécution ou session ouverte |
| Lignes par page | application | 10, 20, 50 | 10 | Immédiatement |

**Appels d’outils par tour** est le nombre d’appels d’outils qu’un tour de l’agent peut effectuer. Quand la limite est atteinte, VERA n’exécute plus d’outils dans ce tour et demande à l’agent de résumer ce qu’il a fait et ce qui reste ; le chat affiche ensuite **Continuer**, qui envoie un message pour que l’agent reprenne là où il s’est arrêté.

**Délai sans sortie du modèle** est la durée pendant laquelle un modèle hébergé peut ne rien envoyer avant que la requête se termine par un dépassement de délai ; augmentez-le pour les modèles de raisonnement lents. **Attente des en-têtes des fournisseurs hébergés** est la durée pendant laquelle VERA attend qu’un fournisseur hébergé commence à répondre. Un point de terminaison personnalisé utilise pour les deux son propre **Délai de réponse**.

**Compactage du contexte.** Quand une conversation dépasse le **Seuil de compactage** du budget d’entrée du modèle, VERA résume l’historique antérieur et conserve tel quel la partie la plus récente (**Historique récent conservé tel quel**, au plus un cinquième du budget). Avec **Compactage en arrière-plan** activé, le résumé s’exécute juste après un tour ; désactivé, le message suivant résume d’abord, si nécessaire. **Taille des résultats d’outils dans les résumés** et **Passes de résumé par requête** limitent la part de chaque résultat d’outil qu’un résumé transmet et le nombre de résumés qu’une requête peut produire. Avec **Compactage automatique** désactivé, une session envoie tout son historique tant qu’il tient ; le tour s’arrête ensuite à la limite de contexte.

**Décompte des jetons.** VERA compte une requête avec le rapport indiqué par le fournisseur pour les requêtes précédentes, plus la **Marge de calibrage** : 110 compte 1,1 fois. Augmentez la marge quand des erreurs de limite de contexte apparaissent. Désactivez **Utiliser le décompte de jetons du fournisseur** quand un fournisseur indique une consommation erronée ; VERA compte alors avec son estimation prudente.

**Sessions déléguées par banc de travail** est le nombre de sessions déléguées pouvant s’exécuter en même temps dans un même banc de travail. Une session supplémentaire est refusée jusqu’à ce qu’une autre se termine.

**Tours simultanés** est le nombre de tours de l’agent pouvant s’exécuter en même temps dans tous les bancs de travail ouverts, sessions déléguées comprises. Un tour qui attend votre approbation compte jusqu’à sa fin. À la limite, un nouveau message n’est pas envoyé et reste dans la zone de saisie avec ses pièces jointes ; dès qu’un tour se termine, VERA indique qu’un tour peut démarrer et vous l’envoyez à nouveau. Un message adressé à une session dont le tour est en cours rejoint ce tour et est toujours accepté. Une session déléguée lancée à la limite est refusée immédiatement. Une valeur plus basse n’arrête aucun tour en cours ; elle s’applique au message suivant.

**Documents.** **Taille maximale des fichiers texte** limite les documents texte ; les fichiers PDF et Office utilisent **Taille maximale des fichiers** dans **Documents et RAG**, qui relève ou abaisse leur limite jusqu’à 500 Mo. Une modification réindexe les documents concernés. **Avertissement de volume** fixe quand l’aperçu des Documents avertit d’une grande sélection. **Résultats du panneau Docs** est le nombre de résultats qu’une recherche du panneau Docs affiche. **Durée limite d’extraction des documents** est la durée de base pour lire un PDF ou un document Office (les grands PDF obtiennent davantage), PDF téléchargés compris. **Pause d’indexation** est la durée d’attente de l’indexation après une modification, et **Inactivité du worker d’embedding** la durée de conservation d’un worker d’embedding inutilisé.

**Bureau.** **Terminaux par banc** limite les terminaux ouverts ; une valeur plus basse n’en ferme aucun, mais un nouveau est refusé tant que la limite est atteinte. **Mémoire du terminal** est la sortie que chaque terminal garde, lue à son ouverture, et **Historique du terminal** le nombre de lignes que son affichage fait défiler en arrière. **Sortie du terminal pour l’agent** est la part de la sortie récente qu’une lecture de l’agent renvoie ; la **Taille d’un résultat d’outil** la limite toujours. **Intervalle de vérification des mises à jour** et **Intervalle de vérification du catalogue de plugins** fixent la fréquence des vérifications ; une modification enregistrée démarre la nouvelle attente sans vérifier aussitôt. **Conservation des journaux** est le nombre de fichiers journaux quotidiens que VERA garde. **Lignes de conversation affichées d’abord** et **Lignes de conversation par chargement** fixent combien des messages les plus récents une conversation affiche dès l’ouverture, puis combien de messages plus anciens elle ajoute à chaque fois en arrière-plan jusqu’à les afficher tous. **Lignes par page** est la taille de départ des listes ; une taille choisie dans une liste reste pour cette liste.

**Outils, programmes et web.** **Taille d’un résultat d’outil** borne chaque résultat d’outil que le modèle reçoit ; une taille inférieure à la **Taille de lecture** raccourcit aussi les lectures. **Fenêtre de lecture**, **Résultats grep**, **Résultats de recherche web** et **Taille de lecture web** sont à la fois la quantité utilisée quand l’agent n’en demande aucune et le maximum qu’il peut demander. Grep ignore les fichiers plus grands que la **Taille de fichier pour grep**. **Délai des workers** borne chaque recherche de texte ou analyse de journal ; une tâche déjà en cours garde son délai. **Taille de téléchargement** s’affiche dans l’approbation du téléchargement et y reste liée : un changement ultérieur ne modifie pas un téléchargement approuvé, et un fichier plus grand s’arrête avec « Download exceeds the size limit. » **Durée limite d’un téléchargement** borne le transfert ; la lecture du texte d’un PDF téléchargé garde son propre délai. **Délai par défaut des programmes** s’applique lorsque ni la règle du plugin ni le programme ne fixe de durée ; **Plafond de durée des commandes shell** borne chaque commande shell au premier plan et s’affiche dans son approbation. **Programmes en arrière-plan par session** limite les exécutions en arrière-plan d’une conversation ; une exécution supplémentaire est refusée comme occupée.

Le **Délai de détection des modèles** couvre le catalogue LM Studio ou celui d’un fournisseur prédéfini, toutes pages comprises. Le test de connexion utilise le délai de réponse du modèle ou le délai d’inactivité de l’application pour chaque essai du modèle. Le **Délai de navigation du navigateur** s’applique à l’ouverture d’une page et au suivi d’un lien. Le mode automatique laisse 35 s à l’ouverture, démarrage compris, et 12 s au suivi d’un lien. Le proxy du navigateur limite chaque requête séparément. Le **Délai de transcription** comprend le chargement de Whisper et le traitement de l’enregistrement.

## Compacter maintenant

**Compacter maintenant** dans les **Paramètres avancés** d’une session résume aussitôt l’historique antérieur, sans attendre le seuil et même avec le compactage automatique désactivé. Il est disponible tant que la session ne travaille pas ; une session archivée ou un banc en lecture seule le refuse. La boîte de dialogue affiche le résultat, par exemple « Historique résumé. »

## Ligne de commande

`vera run` accepte les paramètres de session pour une exécution : `--advanced toolCallsPerTurn=100`, `--advanced noOutputTimeout=900` ou `--advanced autoCompaction=off`. Un interrupteur accepte `on`, `off`, `true` ou `false`. Ces valeurs ne s’appliquent qu’à cette exécution et ne sont pas enregistrées dans la session. Répétez l’option pour plusieurs paramètres. Un paramètre inconnu, un paramètre qui n’est pas un paramètre de session ou une valeur hors plage s’arrête avec une erreur d’utilisation.
