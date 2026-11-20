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

Collez ou déposez une image dans le champ de message, ou choisissez **Joindre une image** pour sélectionner un fichier. Dans Fichiers, faites glisser l’image vers le champ de message ou choisissez **Joindre une image** dans son menu. Retirez une image avec le bouton de sa vignette. VERA conserve les originaux importés dans le banc de travail. Les images jointes depuis Fichiers gardent leurs chemins.

Sélectionnez la vignette d’un message envoyé pour ouvrir l’image dans la visionneuse de fichiers. Si l’image est introuvable, le message affiche son chemin enregistré dans le banc de travail.

Un message peut référencer jusqu’à huit images PNG, JPEG, GIF ou WebP du banc de travail, dans la limite de 20 Mio par fichier. VERA réduit la copie envoyée au modèle à 2048 pixels au maximum sur le côté le plus long et conserve le fichier original. Un modèle qui accepte uniquement du texte reçoit les chemins. La synthèse des anciens messages conserve les chemins des images sous forme de notes textuelles. Les exports de session incluent ces chemins.

Consultez [Fournisseurs et modèles](providers.md) pour savoir comment VERA détermine si le modèle choisi accepte les images.

Indiquez à l’agent le chemin relatif d’une image du banc de travail pour qu’il l’examine. Avec un modèle compatible, il peut utiliser `view_image` pour lire des fichiers PNG, JPEG, GIF ou WebP de 20 Mio maximum. Le côté le plus long de la copie envoyée au modèle mesure au plus 2048 pixels. L’outil exige un chemin autorisé du banc, sans lien, même en mode Contournement. Le résultat dans l’historique de la session conserve le chemin. **Modifier le banc** → **Outils** affiche l’option si le modèle par défaut du banc accepte les images.

L’agent peut rouvrir une image envoyée dans cette session en utilisant son chemin enregistré. Il peut examiner jusqu’à huit images par étape et conserve pendant le tour les huit dernières images ouvertes par l’outil.

## Dicter un message

Sélectionnez un modèle dans [Paramètres > Dictée](settings.md). En mode maintien, maintenez le bouton du microphone ou son raccourci. Lorsque le bouton a le focus, maintenez Espace ou Entrée. Relâchez pour transcrire. En mode démarrage et arrêt, appuyez une fois pour enregistrer et une seconde fois pour transcrire. Échap ou Annuler la dictée abandonne l’enregistrement ou la transcription et laisse l’agent poursuivre son travail. La dictée est annulée si vous quittez le chat ou si la fenêtre perd le focus.

Le résultat apparaît à la position initiale du curseur ou après le texte sélectionné. Si vous avez modifié le brouillon pendant la dictée, le résultat s’ajoute à la fin. Le texte et les pièces jointes restent dans le brouillon. Relisez le texte et envoyez-le avec Entrée ou Envoyer.

## Orienter ou arrêter un tour en cours

Pendant que l’agent travaille, vous pouvez continuer à écrire et envoyer d’autres messages, par exemple « vérifie aussi l’errata ». Ils affichent **En attente d’envoi** jusqu’à ce que l’agent les prenne en compte à son étape suivante. Tant qu’une carte d’approbation attend votre décision, l’envoi est suspendu.

**Arrêter** termine le tour en cours. Escape demande aussi **Arrêter le tour en cours ?**. Le travail déjà terminé, comme les modifications de fichiers appliquées, est conservé.

## Suivre les sessions déléguées

Lorsque VERA délègue une tâche, **Sessions déléguées** dans le chat parent affiche chaque session enfant et son état. Sélectionnez une session enfant pour ouvrir son onglet Chat et suivre la conversation. **Session parente** permet de revenir au chat parent.

Pour arrêter une session enfant en cours, ouvrez-la et choisissez **Arrêter** près de la zone de saisie. La session parente peut continuer son travail. Si une approbation est demandée, utilisez la carte d’approbation de la session concernée. Quand vous rouvrez une session après avoir redémarré VERA, le lien et le résultat du tour délégué restent disponibles.

## Niveaux de détail

**Niveau de détail** se règle par banc de travail dans **Modifier le banc** → **Agent et conversation** :

| Niveau | Ce que la conversation affiche |
|---|---|
| **Détaillé** | Chaque appel d’outil avec ses arguments et sa sortie, le raisonnement du modèle et les statistiques de jetons sous chacun de vos messages |
| **Normal** | Les appels d’outils de routine, regroupés dans une ligne dépliable **Opérations** |
| **Minimal** | Uniquement la conversation ; les appels d’outils de routine sont masqués et un indicateur d’activité s’affiche pendant que l’agent travaille |

Les approbations qui vous attendent, les erreurs et les cartes de téléchargement s’affichent à tous les niveaux ; les approbations accordées par le mode d’autorisation sont masquées en **Minimal** et regroupées en **Normal**. Le niveau ne change que l’affichage ; la session enregistrée et ses exports sont toujours complets.

Les activités affichent une action courte, le fichier, la page ou la commande concernés et leur état. Dépliez-les pour lire le résultat ou la commande exacte et le dossier de travail. **Détails techniques** contient le nom de l’outil, la durée, les arguments d’origine et le résultat brut ; les grands extraits enregistrés restent chargeables en entier. Un code de sortie non nul apparaît comme une erreur et les exécutions en arrière-plan sont distinguées. Les niveaux de détail et les demandes d’approbation gardent leur comportement. Les mises à jour du plan affichent les étapes réelles et leur état au dépliage ; les détails techniques restent facultatifs et séparés.

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

**Afficher/masquer le panneau droit** affiche des onglets pour la session ouverte : **Instructions et compétences** (instructions du banc de travail et compétences disponibles), **Fichiers**, **Modifications**, **Artefacts** (résultats texte enregistrés par l’agent, avec **Exporter** et **Afficher dans le dossier**), **Plan** (la liste de tâches de l’agent) et **Exécutions** (exécutions de programmes des plugins).

## Signets

Survolez un de vos messages ou utilisez Tab pour atteindre son icône de signet. **Ajouter un signet** le marque ; l’icône remplie propose **Retirer le signet**. L’aperçu dans la barre affiche la première ligne du message et le début de la réponse de l’agent, avec la même action de signet. La modification apparaît immédiatement ; un échec d’enregistrement rétablit l’état précédent et affiche une erreur. Les sessions archivées et les bancs en lecture seule permettent seulement la consultation.

Les repères avec signet sont pleins, dans la couleur principale et un peu plus longs. Un groupe est marqué dès qu’un de ses messages a un signet. Utilisez **Signet suivant** (**Ctrl+Alt+N**) ou **Signet précédent** (**Ctrl+Alt+P**) pour passer entre les messages marqués ; la navigation s’arrête au premier ou au dernier signet. Modifiez les touches dans **Paramètres → Raccourcis clavier**.

## Commandes shell

Utilisez des options non interactives : l’entrée standard de l’agent est fermée. Les commandes au premier plan renvoient le code de sortie, les 12 000 derniers caractères et le journal complet dans `.vera/runs`. Les commandes en arrière-plan renvoient un identifiant ; l’agent lit `program_output`, utilise `until` pour un message de disponibilité et les arrête avec `program_stop`. Elles continuent après l’appel et s’arrêtent avec la session, l’application ou le mode Contournement qui les a lancées. La vue locale des exécutions suit le masquage des secrets des exécutions ; les journaux locaux gardent la sortie originale. Le processus hérite de l’environnement utilisateur sans les clés des fournisseurs VERA ni les valeurs des identifiants stockés. Les commandes sont limitées à 4 096 caractères.

Les accords de commande et les préfixes enregistrés sont décrits dans [Autorisations](permissions.md) ; les dossiers hors du banc dans [Bancs de travail](workbenches.md).

## Commandes dans Exécutions

Ouvrez **Exécutions** dans le panneau droit pour voir la commande exacte, le dossier, la sortie en direct, le code de sortie et la durée. **Arrêter** termine tout l’arbre des processus ; l’agent voit cet arrêt à sa prochaine lecture de sortie. Pour les exécutions terminées, **Ouvrir le journal** affiche le journal conservé dans le lecteur de texte, y compris la sortie antérieure à la fin affichée ; pour un journal de plus de 8 MiB, les 8 derniers MiB sont affichés. La session courante est sélectionnée par défaut ; **Toutes les sessions** affiche les autres exécutions. Les programmes des plugins gardent leurs noms déclarés. Le masquage des exécutions est désactivé par défaut. Activé, il masque les secrets stockés dans les arguments, commandes, dossiers, erreurs, sorties et états des programmes. Le choix du banc prime sur celui de l’application. Les changements actualisent les journaux ouverts, y compris les journaux complets du lecteur ; les journaux locaux conservent le texte original.

## Terminal utilisateur

Ouvrez **Terminal** à droite ou appuyez sur **Ctrl+Shift+T**. Le shell interactif démarre dans le dossier du banc selon Paramètres → Commandes. **Nouveau terminal** crée des onglets ; **Fermer le terminal** les termine. Redimensionnez le panneau pour réorganiser la sortie. Les programmes interactifs acceptent votre saisie. L’arrêt d’une session d’agent laisse les terminaux ouverts ; fermer ou remplacer le banc, ou quitter VERA, les ferme. Le support natif est inclus.

Les réponses et blocs de code ont des actions de copie séparées. L’exécution est disponible pour les blocs complets explicitement marqués PowerShell ou Bash, de 1 à 16 384 caractères et sans caractères de contrôle du terminal. Elle vise uniquement un shell vierge inutilisé dont l’invite initiale vide est vérifiée avant exécution. Seules les destinations admissibles sont proposées ; sinon, Exécuter crée immédiatement un terminal vierge. Si la destination reçoit une saisie ou exécute une commande après sa sélection, VERA refuse l’injection et propose **Exécuter dans un nouveau terminal vierge**. Votre texte non envoyé et vos programmes interactifs restent intacts. Les terminaux vierges ignorent les profils shell ; **Nouveau terminal** conserve le démarrage normal du shell configuré. **Nouveau terminal vierge (sans profil shell)** crée un shell compatible séparé. Annuler ou Échap ramène le focus clavier sur Exécuter.

Chaque terminal démarre en privé. Pour autoriser l’agent à en lire un, voir [Autorisations](permissions.md).

## Masquage des secrets pour l’agent et les exports

Agent et modèle masque les résultats d’outils envoyés au fournisseur, les réponses en direct ainsi que la recherche et l’affichage des sessions. Le masquage vérifie le texte du chemin du fichier. Les pixels de l’image sont hors de son champ. Artefacts et exports contrôle indépendamment les contenus et descriptions enregistrés, les exports d’artefacts et les exports JSON/Markdown des sessions. Les deux sont activés par défaut ; un choix explicite du banc prime sur le réglage courant de l’application. Désactiver le masquage de l’agent permet aux secrets stockés trouvés dans des fichiers ou sorties d’outils d’atteindre le fournisseur. Exécutions et Affichage ne changent pas ces règles. Erreurs du fournisseur, tests de connexion et journaux de diagnostic masquent toujours les identifiants stockés. La lecture exige toujours l’accord propre à ce terminal. Un texte déjà enregistré comme [REDACTED] reste irrécupérable par désactivation ; relisez la source originale ou recréez l’artefact.
