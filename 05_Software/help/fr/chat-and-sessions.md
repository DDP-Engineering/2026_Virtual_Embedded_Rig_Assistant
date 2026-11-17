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

Les repères avec signet sont pleins, dans la couleur principale et un peu plus longs. Un groupe est marqué dès qu’un de ses messages a un signet. Utilisez **Signet suivant** (**Ctrl+Alt+N**) ou **Signet précédent** (**Ctrl+Alt+P**) pour passer entre les messages marqués ; la navigation s’arrête au premier ou au dernier signet. Modifiez les touches dans **Paramètres → Raccourcis clavier**.

## Commandes shell

Utilisez des options non interactives : l’entrée standard de l’agent est fermée. Les commandes au premier plan renvoient le code de sortie, les 12 000 derniers caractères et le journal complet dans `.vera/runs`. Les commandes en arrière-plan renvoient un identifiant ; l’agent lit `program_output`, utilise `until` pour un message de disponibilité et les arrête avec `program_stop`. Elles continuent après l’appel et s’arrêtent avec la session, l’application ou le mode Bypass qui les a lancées. La vue locale des exécutions suit le masquage des secrets des exécutions ; les journaux locaux gardent la sortie originale. Le processus hérite de l’environnement utilisateur sans les clés des fournisseurs VERA ni les valeurs des identifiants stockés. Les commandes sont limitées à 4 096 caractères.

Demander exige un accord pour chaque commande. En Modification auto, Toujours autoriser enregistre le préfixe littéral choisi pour ce banc ; npm test permet aussi npm test -- --watch=false. Modifier le banc > Agent liste ces préfixes ; supprimez-en un et enregistrez pour rétablir immédiatement la demande. Les suppressions récursives, push forcés, reset hard, formatages et outils de disque demandent toujours hors Bypass et ne peuvent pas être enregistrés. La syntaxe complexe, les mots entre guillemets ou échappés, les tubes, substitutions et séparateurs exigent aussi un accord explicite. Les préfixes autorisent les arguments sans isoler les effets des scripts.

## Dossiers supplémentaires

Les outils ordinaires read, list, glob, grep, write et edit ainsi que les dossiers de travail shell utilisent ces dossiers avec les mêmes accords Demander ou Modification auto que le banc. Les chemins externes doivent être absolus ; les chemins relatifs partent toujours du banc principal. Les sources externes ont une identité absolue, sans citation locale de document. Les règles d’exclusion restent actives ; les données VERA sont refusées même via des liens. L’ajout n’indexe pas ces dossiers : index, journaux, artefacts et données générées restent dans le banc principal. Les commandes gardent les droits du compte système, sans bac à sable.

## Commandes dans Exécutions

Ouvrez **Exécutions** dans le panneau droit pour voir la commande exacte, le dossier, la sortie en direct, le code de sortie et la durée. **Arrêter** termine tout l’arbre des processus ; l’agent voit cet arrêt à sa prochaine lecture de sortie. Pour les exécutions terminées, **Ouvrir le journal** affiche le journal complet conservé dans le lecteur de texte, y compris la sortie antérieure à la fin affichée. La session courante est sélectionnée par défaut ; **Toutes les sessions** affiche les autres exécutions. Les programmes des plugins gardent leurs noms déclarés. Le masquage des exécutions est désactivé par défaut. Activé, il masque les secrets stockés dans les arguments, commandes, dossiers, erreurs, sorties et états des programmes. Le choix du banc prime sur celui de l’application. Les changements actualisent les journaux ouverts, y compris les journaux complets du lecteur ; les journaux locaux conservent le texte original.

## Terminal utilisateur

Ouvrez **Terminal** à droite ou appuyez sur **Ctrl+Shift+T**. Le shell interactif démarre dans le dossier du banc selon Paramètres → Commandes. **Nouveau terminal** crée des onglets ; **Fermer le terminal** les termine. Redimensionnez le panneau pour réorganiser la sortie. Les programmes interactifs acceptent votre saisie. L’arrêt d’une session d’agent laisse les terminaux ouverts ; fermer ou remplacer le banc, ou quitter VERA, les ferme. Le support natif est inclus.

Chaque terminal démarre en privé. Activez **Autoriser l’agent à lire ce terminal** séparément pour chaque terminal à partager. L’agent peut lister les terminaux partagés et lire leur sortie récente limitée avec terminal_read ; il ne peut ni créer, ni saisir, ni redimensionner, ni fermer les terminaux. Désactiver l’accord ou fermer le terminal bloque les lectures futures. La sortie déjà partagée reste dans l’historique. Le shell utilise vos droits système sans sandbox. VERA filtre les variables héritées contenant des identifiants. La sortie locale du terminal suit le masquage des exécutions, désactivé par défaut ; les lectures autorisées de l’agent masquent toujours les identifiants indépendamment. Le profil du shell et les programmes restent sous votre contrôle.
