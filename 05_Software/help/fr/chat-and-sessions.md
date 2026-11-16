# Discussion et sessions

Une session est une conversation avec l’agent au sein d’un banc de travail. VERA enregistre chaque session dans le banc de travail : vous pouvez donc fermer l’application et reprendre plus tard. Plusieurs sessions peuvent s’exécuter en même temps.

## Démarrer et gérer des sessions

- **Nouvelle session** démarre une conversation dans le banc de travail ouvert. S’il existe une session vide inutilisée, VERA l’ouvre au lieu d’en créer une autre.
- Le premier message devient le titre. **Renommer** définit votre propre titre.
- **Rechercher des sessions** trouve des sessions par titre et par texte des messages.
- Chaque ligne de session indique l’heure de sa dernière activité et possède un menu avec **Exporter en Markdown**, **Exporter en JSON**, **Renommer**, **Monter**, **Descendre**, **Archiver** et **Supprimer**.
- Une session affiche son état : **Inactive**, **En cours**, **En attente d’approbation** ou **Erreur**.

## Écrire un message

Saisissez votre texte dans la zone de message (**Interrogez VERA sur votre projet…**). Enter envoie, Shift+Enter ajoute une ligne, et @ complète les chemins des fichiers du banc de travail. Pour donner un fichier à l’agent, choisissez **Joindre comme contexte** sur ce fichier dans l’onglet **Fichiers** ; il apparaît sous forme de puce au-dessus de la zone de message.

À côté de la zone de message, vous choisissez le **Modèle**, le **Niveau de raisonnement** et le **Mode d’autorisation** de cette session. Les nouvelles sessions reprennent le modèle et le mode d’autorisation des paramètres du banc de travail.

## Orienter ou arrêter un tour en cours

Pendant que l’agent travaille, vous pouvez continuer à écrire et envoyer d’autres messages, par exemple « vérifie aussi l’errata ». Ils affichent **En attente d’envoi** jusqu’à ce que l’agent les prenne en compte à son étape suivante. Tant qu’une carte d’approbation attend votre décision, l’envoi est suspendu.

**Arrêter** termine le tour en cours. Escape demande aussi **Arrêter le tour en cours ?**. Le travail déjà terminé, comme les modifications de fichiers appliquées, est conservé.

## Niveaux de détail

**Niveau de détail** se règle par banc de travail dans **Modifier le banc** → **Agent et conversation** :

| Niveau | Ce que la conversation affiche |
|---|---|
| **Détaillé** | Chaque appel d’outil avec ses arguments et sa sortie, le raisonnement du modèle et les statistiques de jetons sous chacun de vos messages |
| **Normal** | Les appels d’outils de routine, regroupés dans une ligne dépliable **Opérations** |
| **Minimal** | Uniquement la conversation ; les appels d’outils de routine sont masqués et un indicateur d’activité s’affiche pendant que l’agent travaille |

Les approbations qui vous attendent, les erreurs et les cartes de téléchargement s’affichent à tous les niveaux ; les approbations accordées par le mode d’autorisation sont masquées en **Minimal** et regroupées en **Normal**. Le niveau ne change que l’affichage ; la session enregistrée et ses exports sont toujours complets.

## Raisonnement

Pour les modèles qui le prennent en charge, **Niveau de raisonnement** propose **Par défaut** et les niveaux déclarés par le modèle, par exemple **Minimal**, **Faible**, **Moyen**, **Élevé** ou **Maximal**. Avec un niveau plus élevé, le modèle réfléchit plus longtemps avant de répondre. Pour les modèles sans niveaux de raisonnement, la commande est masquée. Vous pouvez la modifier pendant un tour ; le nouveau niveau s’applique à la requête suivante. Le texte du raisonnement lui-même ne s’affiche qu’au niveau **Détaillé**.

## Sessions longues et contexte

L’indicateur de contexte affiche **Contexte utilisé** en pourcentage de la fenêtre de contexte du modèle ; sélectionnez-le pour voir l’utilisation et les limites. Lorsqu’une session devient trop longue pour le modèle, VERA résume l’historique ancien (**Résumé de l’historique…**). La transcription complète reste enregistrée et visible.

**Rechercher dans la conversation** effectue une recherche dans la session en cours. La bande de repères au bord gauche de la conversation comporte un repère par message que vous avez envoyé ; survolez un repère pour avoir un aperçu du message et sélectionnez-le pour y accéder.

## Archiver, supprimer et exporter

- **Archiver** déplace une session terminée dans **Sessions archivées** ; **Restaurer** la fait revenir. Rien n’est perdu.
- **Supprimer** supprime la session et ses artefacts après confirmation. Les fichiers téléchargés par l’agent restent dans le banc de travail.
- **Exporter en Markdown** écrit une transcription lisible avec les résumés des outils, les citations et les modifications appliquées ; **Exporter en JSON** écrit l’enregistrement complet des événements. Les deux ouvrent une boîte de dialogue d’enregistrement et fonctionnent aussi dans les bancs de travail en lecture seule.

Les signets enregistrés restent dans les exports JSON ; Markdown indique les messages utilisateur marqués. Les signets appartiennent à la session et ne sont pas envoyés à l’agent.

## Le panneau droit

**Afficher/masquer le panneau droit** affiche des onglets pour la session ouverte : **Contexte** (instructions du banc de travail et compétences disponibles), **Fichiers**, **Modifications**, **Artefacts** (résultats texte enregistrés par l’agent, avec **Exporter** et **Afficher dans le dossier**), **Plan** (la liste de tâches de l’agent) et **Exécutions** (exécutions de programmes des plugins).

## Signets

Survolez un de vos messages ou utilisez Tab pour atteindre son icône de signet. **Ajouter un signet** le marque ; l’icône remplie propose **Retirer le signet**. L’aperçu dans la barre affiche la première ligne du message et le début de la réponse de l’agent, avec la même action de signet. La modification apparaît immédiatement ; un échec d’enregistrement rétablit l’état précédent et affiche une erreur. Les sessions archivées et les bancs en lecture seule permettent seulement la consultation.
