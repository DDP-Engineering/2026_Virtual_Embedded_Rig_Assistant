# Discussion et sessions

## Ouvrir une trame citée dans Wireshark

Dans la réponse de l’agent, sélectionnez **Ouvrir la trame … dans Wireshark**, puis **Ouvrir dans Wireshark**. Installez Wireshark Desktop et TShark localement. VERA vérifie le fichier PCAP ou PCAPNG cité et ouvre une copie vérifiée au numéro de trame propre à ce fichier, y compris pour une capture dérivée.

Laissez **Filtre d’affichage** vide pour reprendre le filtre de la citation, s’il existe. Vous pouvez saisir un autre filtre d’affichage hors ligne. Si le filtre masque la trame citée, VERA l’ajoute au filtre et vous en informe. Si la capture a changé ou est inaccessible, inspectez-la de nouveau pour obtenir une nouvelle citation.

Une session est une conversation avec l’agent au sein d’un banc de travail. VERA enregistre chaque session dans le banc de travail : vous pouvez donc fermer l’application et reprendre plus tard. Plusieurs sessions peuvent s’exécuter en même temps. Par défaut, au plus quatre tours s’exécutent en même temps dans tous les bancs de travail ouverts, ou le nombre défini par **Tours simultanés** dans [Paramètres avancés](advanced-settings.md) ; un message envoyé à la limite reste non envoyé dans la zone de saisie jusqu’à la fin d’un tour.

## Démarrer et gérer des sessions

- **Nouvelle session** démarre une conversation dans le banc de travail ouvert. S’il existe une session vide inutilisée, VERA l’ouvre au lieu d’en créer une autre.
- Le premier message devient le titre. Utilisez **Renommer** à tout moment, y compris pendant un tour.
- Sélectionnez la loupe **Rechercher des sessions** à côté de **Nouvelle session** pour chercher par titre et par texte des messages. Appuyez sur **Échap** dans le champ de recherche ou sélectionnez de nouveau la loupe pour retrouver la liste complète. Utilisez les commandes de pagination sous les listes longues pour voir les autres sessions.
- Chaque ligne de session indique l’heure de sa dernière activité et possède un menu avec **Exporter en Markdown**, **Exporter en JSON**, **Renommer**, **Monter**, **Descendre**, **Archiver** et **Supprimer**.
- Une session affiche son état : **Inactive**, **En cours**, **En attente d’approbation** ou **Erreur**. Une session en cours porte une marque qui tourne près de l’heure, et une session en attente d’approbation un bouclier.

## Sessions des autres bancs de travail

Les tours continuent lorsque vous ouvrez un autre banc de travail. Dans la barre latérale, la ligne d’un banc de travail affiche une marque avec le nombre de ses sessions en cours et en attente, même lorsque la ligne est repliée ; un bouclier signale une session qui attend votre approbation. Sélectionnez la marque (ou donnez-lui le focus et appuyez sur Entrée) pour lister ces sessions. Choisissez une session pour l’ouvrir dans son banc de travail, où vous pouvez examiner l’approbation, ou **Arrêter** pour ne terminer que ce tour. Pendant les tours, **Bancs de travail** indique combien s’exécutent et la limite **Tours simultanés**. À la limite, un nouveau message reste dans la zone de saisie : attendez la fin d’un tour ou arrêtez-en un dans la barre latérale, puis envoyez-le de nouveau.

## Activité

Ouvrez **Activité** dans la barre de titre pour voir les sessions en cours, les approbations et questions en attente et les réponses non lues de tous les bancs de travail. Utilisez Tab pour vous déplacer dans la vue, Entrée pour ouvrir un élément et Échap pour fermer la vue. VERA demande confirmation avant d’abandonner les modifications non enregistrées. Une question encore en attente s’ouvre sur sa carte.

Les réponses non lues restent accessibles lorsque les alertes du bureau sont désactivées. VERA conserve jusqu’à 100 réponses terminées avec succès depuis le lancement de l’application. L’ouverture d’une réponse non lue la marque comme lue. **Tout marquer comme lu** vide cette liste et laisse visibles les sessions en cours et les demandes en attente.

## Écrire un message

Saisissez votre texte dans la zone de message (**Interrogez VERA sur votre projet…**). Enter envoie, Shift+Enter ajoute une ligne, et @ complète les chemins des fichiers du banc de travail. Pour donner un fichier à l’agent, choisissez **Joindre comme contexte** sur ce fichier dans l’onglet **Fichiers** ; il apparaît sous forme de puce au-dessus de la zone de message.

À côté de la zone de message, vous choisissez le **Modèle**, le **Niveau de raisonnement** et le **Mode d’autorisation** de cette session. Les nouvelles sessions reprennent le modèle et le mode d’autorisation des paramètres du banc de travail.

Collez ou déposez une image dans le champ de message, ou choisissez **Joindre une image** pour sélectionner un fichier. Dans Fichiers, faites glisser l’image vers le champ de message ou choisissez **Joindre une image** dans son menu. Retirez une image avec le bouton de sa vignette. VERA conserve les originaux importés dans le banc de travail. Les images jointes depuis Fichiers gardent leurs chemins.

Sélectionnez la vignette d’un message envoyé pour ouvrir l’image dans la visionneuse de fichiers. Si l’image est introuvable, le message affiche son chemin enregistré dans le banc de travail.

Par défaut, un message peut inclure jusqu’à huit images PNG, JPEG, GIF ou WebP, dans la limite de 20 Mio par fichier. Modifiez ces limites dans **Paramètres** → **Avancé** → **Images**. Le fournisseur peut refuser une requête qui dépasse ses propres limites. VERA réduit la copie envoyée au modèle à 2048 pixels au maximum sur le côté le plus long et conserve le fichier original. Un modèle qui accepte uniquement du texte reçoit les chemins. La synthèse des anciens messages conserve les chemins des images sous forme de notes textuelles. Les exports de session incluent ces chemins.

Consultez [Fournisseurs et modèles](providers.md) pour savoir comment VERA détermine si le modèle choisi accepte les images.

Indiquez à l’agent le chemin relatif d’une image du banc de travail pour qu’il l’examine. Avec un modèle compatible, il peut utiliser `view_image` pour lire des fichiers PNG, JPEG, GIF ou WebP dans la limite de taille configurée. Le côté le plus long de la copie envoyée au modèle mesure au plus 2048 pixels. L’outil exige un chemin autorisé du banc, sans lien, même en mode Contournement. Le résultat dans l’historique de la session conserve le chemin. **Modifier le banc** → **Outils** affiche l’option si le modèle par défaut du banc accepte les images.

L’agent peut rouvrir une image envoyée dans cette session en utilisant son chemin enregistré. Il peut examiner jusqu’à huit images par étape et conserve pendant le tour les huit dernières images ouvertes par l’outil.

## Dicter un message

Sélectionnez un modèle dans [Paramètres > Dictée](settings.md). En mode maintien, maintenez le bouton du microphone ou son raccourci. Lorsque le bouton a le focus, maintenez Espace ou Entrée. Relâchez pour transcrire. En mode démarrage et arrêt, appuyez une fois pour enregistrer et une seconde fois pour transcrire. Échap ou Annuler la dictée abandonne l’enregistrement ou la transcription et laisse l’agent poursuivre son travail. La dictée est annulée si vous quittez le chat ou si la fenêtre perd le focus.

Le résultat apparaît à la position initiale du curseur ou après le texte sélectionné. Si vous avez modifié le brouillon pendant la dictée, le résultat s’ajoute à la fin. Le texte et les pièces jointes restent dans le brouillon. Relisez le texte et envoyez-le avec Entrée ou Envoyer.

## Orienter ou arrêter un tour en cours

Pendant que l’agent travaille, vous pouvez continuer à écrire et envoyer d’autres messages, par exemple « vérifie aussi l’errata ». Ils affichent **En attente d’envoi** jusqu’à ce que l’agent les prenne en compte à son étape suivante. Vous pouvez modifier le brouillon pendant l’envoi d’un message ou l’attente d’une approbation. L’envoi redevient disponible après l’acceptation du message ou la décision. Le brouillon reste dans sa session quand vous changez de vue.

**Arrêter** termine le tour en cours. Échap ouvre **Arrêter le tour en cours ?** et place le focus sur **Arrêter**. Appuyez sur Entrée pour arrêter le tour. Le travail déjà terminé, comme les modifications de fichiers appliquées, est conservé.

## Répondre à une question

Lorsque VERA pose une question, choisissez une réponse ou saisissez la vôtre, puis sélectionnez **Envoyer la réponse**. Appuyez sur Entrée pour envoyer une réponse saisie. Vous pouvez également écrire votre réponse dans la zone de message principale et l’envoyer de là. La carte indique la réponse recommandée. Sélectionnez **Annuler la question** pour poursuivre le tour avec une annulation, ou arrêtez le tour. Une question en attente s’ouvre depuis le menu d’activité du banc de travail.

Dans les réglages **Agent et chat** du banc de travail, l’option **Utiliser les réponses recommandées après un délai** est désactivée par défaut. Activez-la et choisissez un nombre entier de 1 à 1440 minutes. Lorsqu’une recommandation est valide, la carte affiche l’échéance et la conversation indique les réponses automatiques. Le délai continue en arrière-plan et pendant le rechargement de l’interface. Les opérations soumises à approbation la demandent séparément.

## Suivre les sessions déléguées

Lorsque VERA délègue une tâche, la session enfant apparaît en retrait sous sa session parente dans la liste des sessions, avec le résultat de son dernier tour délégué. Utilisez la flèche devant la session parente pour afficher ou masquer ses sessions enfants ; VERA mémorise ce choix pour le banc de travail. Tant qu’elles sont masquées, la ligne parente indique si l’une d’elles vous attend, a échoué ou s’exécute. Sélectionnez une session enfant pour ouvrir son onglet Chat et suivre la conversation ; si vous l’ouvrez depuis l’activité ou une notification, elle apparaît dans la liste. Pour revenir à la session parente, sélectionnez sa ligne au-dessus des sessions enfants. **Monter** et **Descendre** déplacent une session enfant parmi ses sœurs et une session parente avec ses enfants. Une session enfant dont la session parente est archivée ou absente des résultats est listée seule.

Pour arrêter une session enfant en cours, ouvrez-la et choisissez **Arrêter** près de la zone de saisie. La session parente peut continuer son travail. Si une approbation est demandée, utilisez la carte d’approbation de la session concernée. Quand vous rouvrez une session après avoir redémarré VERA, le lien et le résultat du tour délégué restent disponibles.

L’agent parent peut envoyer d’autres instructions dans la même conversation enfant et choisir son modèle et son niveau de raisonnement pour les tours suivants. Le fil identifie ces messages comme **Instruction de l’agent parent**. Si la session enfant travaille déjà, une instruction admissible attend la prochaine requête au modèle. Utilisez la carte d’approbation de la session enfant lorsqu’une décision de l’utilisateur est requise.

Une nouvelle session enfant démarre avec le mode d’autorisation actuel de la session parente. L’enfant d’une session parente en mode Bypass démarre en Modification auto, sauf si vous activez **Autoriser l’accès complet pour les tâches déléguées** dans **Paramètres > Données et confidentialité** et confirmez. L’option est désactivée par défaut et concerne les prochains lancements dans tous les bancs de travail ; si vous la désactivez, les sessions existantes gardent leur mode. Après le lancement, choisissez séparément le mode de chaque session dans sa zone de saisie. Réduisez l’accès d’une session enfant dans son propre chat.

Dans une copie de travail partagée, attendez qu’une session enfant termine son travail et vérifiez sa livraison avant de lancer la suivante.

Une session déléguée en mode Bypass suit les mêmes règles qu’une session Bypass directe : les commandes shell, les programmes de plugins et les modifications de fichiers s’exécutent sans demander, y compris la publication à distance comme `git push`. Les programmes bloqués, la vérification de l’installation des plugins et les plugins d’essai gardent leurs propres approbations. En Modification auto, les commandes shell s’exécutent automatiquement seulement si elles correspondent à un préfixe enregistré par l’utilisateur dans le banc de travail ; les autres demandent votre approbation dans le chat de la session enfant.

## Niveaux de détail

**Niveau de détail** se règle par banc de travail dans **Modifier le banc** → **Agent et conversation** :

| Niveau | Ce que la conversation affiche |
|---|---|
| **Détaillé** | Chaque appel d’outil avec ses arguments et sa sortie, le raisonnement du modèle et, sous chacun de vos messages, sa date et son heure d’envoi et ses statistiques de jetons |
| **Normal** | Les appels d’outils de routine, regroupés dans une ligne dépliable **Opérations** |
| **Minimal** | Uniquement la conversation ; les appels d’outils de routine sont masqués et un indicateur d’activité s’affiche pendant que l’agent travaille |

Les approbations qui vous attendent, les erreurs et les cartes de téléchargement s’affichent à tous les niveaux ; les approbations automatiques ordinaires sont masquées en **Minimal** et regroupées en **Normal**. Les écritures sur un appareil et les opérations irréversibles des plugins restent visibles. Le niveau ne change que l’affichage ; la session enregistrée et ses exports sont toujours complets.

Les activités affichent une action courte, le fichier, la page ou la commande concernés et leur état. Dépliez-les pour lire le résultat ou la commande exacte et le dossier de travail. **Détails techniques** contient le nom de l’outil, la durée, les arguments d’origine et le résultat brut ; les grands extraits enregistrés restent chargeables en entier. Un code de sortie non nul apparaît comme une erreur et les exécutions en arrière-plan sont distinguées. Les niveaux de détail et les demandes d’approbation gardent leur comportement. Les mises à jour du plan affichent les étapes réelles et leur état au dépliage ; les détails techniques restent facultatifs et séparés.

## Raisonnement

Pour les modèles qui le prennent en charge, **Niveau de raisonnement** propose **Par défaut** et les niveaux déclarés par le modèle, par exemple **Minimal**, **Faible**, **Moyen**, **Élevé** ou **Maximal**. Avec un niveau plus élevé, le modèle réfléchit plus longtemps avant de répondre. Pour les modèles sans niveaux de raisonnement, la commande est masquée. Vous pouvez la modifier pendant un tour ; le nouveau niveau s’applique à la requête suivante. Le texte du raisonnement lui-même ne s’affiche qu’au niveau **Détaillé**.

## Sessions longues et contexte

L’indicateur de contexte affiche **Contexte utilisé** en pourcentage de la fenêtre de contexte du modèle ; sélectionnez-le pour voir l’utilisation et les limites. Lorsqu’une session devient trop longue pour le modèle, VERA résume l’historique ancien (**Résumé de l’historique…**). Pendant ce temps, l’indicateur tourne et garde le dernier pourcentage, mis à jour dès que la requête suivante est prête. La transcription complète reste enregistrée et visible.

Si le dernier tour échoue à cause d’une erreur temporaire du fournisseur, sélectionnez **Réessayer** pour renvoyer son message. En cas de dépassement du contexte, utilisez **Compacter maintenant** si le bouton est proposé. Quand le tour atteint la limite de sortie ou d’appels d’outils, **Continuer** lance un nouveau tour.

Si le fournisseur refuse la requête à cause de sa taille, choisissez **Modifier les images et réessayer**. Décochez les pièces jointes à retirer et choisissez **Renvoyer le message**. Les pièces jointes initiales restent visibles dans la conversation.

**Rechercher dans la conversation** effectue une recherche dans la session en cours. Appuyez sur Entrée pour le résultat suivant et Maj+Entrée pour le précédent. Envoyez un message ou sélectionnez **Aller au dernier message** pour revenir à la fin. La bande de repères au bord gauche de la conversation comporte un repère par message que vous avez envoyé ; survolez un repère pour avoir un aperçu du message et sélectionnez-le pour y accéder.

## Archiver, supprimer et exporter

- **Archiver** déplace une session terminée dans **Sessions archivées** ; **Restaurer** la fait revenir. Rien n’est perdu.
- **Supprimer** supprime la session et ses artefacts après confirmation. Les fichiers téléchargés par l’agent restent dans le banc de travail.
- **Exporter en Markdown** écrit une transcription lisible avec les résumés des outils, les citations et les modifications appliquées ; **Exporter en JSON** écrit l’enregistrement complet des événements. Les deux ouvrent une boîte de dialogue d’enregistrement et fonctionnent aussi dans les bancs de travail en lecture seule.

Les signets enregistrés restent dans les exports JSON ; Markdown indique les messages utilisateur marqués. Les signets appartiennent à la session et ne sont pas envoyés à l’agent.

## Le panneau droit

**Afficher/masquer le panneau droit** affiche des onglets pour la session ouverte : **Instructions et compétences** (instructions du banc de travail et compétences disponibles), **Fichiers**, **Modifications**, **Artefacts** (résultats texte enregistrés par l’agent, avec **Exporter** et **Afficher dans le dossier**), **Plan** (la liste de tâches de l’agent) et **Exécutions** (exécutions de programmes des plugins).

Sélectionnez une modification dans **Modifications** pour ouvrir son diff dans un onglet à côté du Chat.

Pour demander à l’agent de réutiliser un artefact texte enregistré, donnez sa référence exacte
`artifact:...` dans la même session. Vous pouvez le faire après avoir rouvert la session.

## Onglets ouverts

Choisissez **Rouvrir le dernier onglet fermé** à côté du chat pour retrouver un document ou une comparaison de la session en cours. Faites un clic droit et choisissez **Épingler l’onglet** pour le garder près du chat lors d’une fermeture groupée. Choisissez **Rechercher dans les onglets ouverts** pour filtrer par titre ou chemin, puis sélectionnez un résultat avec la souris ou avec les flèches et Entrée.

Choisissez **Afficher à côté du chat** dans le menu d’un onglet ouvert. Le chat reste visible à gauche, avec l’onglet à droite. Sélectionnez un autre onglet pour changer le volet droit. Faites glisser le séparateur ou utilisez les flèches. **Quitter la vue côte à côte** rétablit un seul volet et conserve les onglets. Dans une fenêtre étroite, utilisez la barre d’onglets.

## Commenter et réviser le plan

Choisissez **Ouvrir le plan** dans le chat pour voir ses étapes. Répondez à une demande de décision dans la carte de question. Si vous êtes dans une autre session, la notification ou l’entrée dans **Activité** ouvre la session et l’onglet **Plan**.

Dans **Plan**, choisissez **Ajouter un commentaire** pour une étape entière ou sélectionnez d’abord du texte dans une seule étape pour citer ce fragment. Au clavier, sélectionnez avec Shift et les flèches dans **Texte de l’étape**, puis choisissez **Utiliser le texte sélectionné** ; **Étape entière** efface le fragment. Une étape vide accepte uniquement un commentaire sur l’étape entière. Saisissez plusieurs lignes, par exemple « Vérifier la tension avant la programmation », puis **Enregistrer le brouillon**. L’enregistrement n’envoie aucun message et ne démarre pas l’agent. Annuler ou Échap abandonne les modifications non enregistrées et ramène le focus sur Plan.

Le nombre de brouillons et de commentaires envoyés ouvre les commentaires de cette étape précise. **Modifier le commentaire** change seulement le texte ; **Supprimer le commentaire** retire un brouillon. Tout remplacement du plan invalide les associations précédentes, même si le texte reste identique. **À réassocier** conserve ces brouillons lisibles : choisissez **Réassocier**, une étape actuelle numérotée, explicitement son texte entier ou un fragment, puis **Enregistrer l’association**. Les brouillons enregistrés survivent à la fermeture et au changement de session.

**Réviser le plan** envoie tout le plan actuel et tous les brouillons valides en une demande dans la même discussion. L’agent peut modifier le plan structuré ou demander des précisions, mais pas exécuter les étapes, modifier les fichiers du projet, lancer des programmes ou commandes, ni accorder des autorisations pendant cette révision. L’envoi de messages ordinaires est désactivé jusqu’à la fin ; **Arrêter** termine seulement la révision, pas les programmes indépendants en arrière-plan. Le mode d’autorisation en lecture seule permet de réviser le plan ; les sessions archivées et les bancs en lecture seule permettent uniquement la consultation.

**Révisions précédentes** conserve les commentaires envoyés, les citations et les résultats, même après effacement du plan. En cas d’échec d’envoi, les brouillons restent disponibles. **Réessayer la révision** confirme un accusé de réception inconnu avec la demande originale, sans créer une seconde révision. Après une révision acceptée mais échouée, arrêtée ou limitée par le contexte, **Restaurer les commentaires** prépare les brouillons manquants sans écraser les brouillons modifiés ni l’historique. Réessayer depuis la discussion fait de même. Réassociez les brouillons obsolètes et choisissez explicitement **Réviser le plan** ; la restauration n’envoie jamais de demande automatiquement. Les limites de contexte existantes s’appliquent toujours.

Un changement de confidentialité ou de modèle actualise l’affichage. L’éditeur ouvert conserve le commentaire non enregistré, mais masque l’ancienne citation ; sélectionnez explicitement une cible actuelle avant d’enregistrer un nouveau commentaire ou une nouvelle association.

## Signets

Survolez un de vos messages ou utilisez Tab pour atteindre son icône de signet. **Ajouter un signet** le marque ; l’icône remplie propose **Retirer le signet**. L’aperçu dans la barre affiche la première ligne du message et le début de la réponse de l’agent, avec la même action de signet. La modification apparaît immédiatement ; un échec d’enregistrement rétablit l’état précédent et affiche une erreur. Les sessions archivées et les bancs en lecture seule permettent seulement la consultation.

Les repères avec signet sont pleins, dans la couleur principale et un peu plus longs. Un groupe est marqué dès qu’un de ses messages a un signet. Utilisez **Signet suivant** (**Ctrl+Alt+N**) ou **Signet précédent** (**Ctrl+Alt+P**) pour passer entre les messages marqués ; la navigation s’arrête au premier ou au dernier signet. Modifiez les touches dans **Paramètres → Raccourcis clavier**.

L’onglet **Signets** du panneau droit liste dans l’ordre les signets de cette conversation, chacun avec le début de votre message et de la réponse. Activez-le dans **Modifier le banc > Interface > Onglets du panneau droit**. Saisissez du texte dans **Filtrer les signets** pour chercher dans le message ou la réponse ; le compteur affiche alors les résultats sur le total. Sélectionnez une ligne ou appuyez sur Entrée pour aller au message dans Chat ; les flèches passent d’une ligne à l’autre. Cochez des lignes (ou **Tout sélectionner** pour les lignes filtrées) et choisissez **Retirer la sélection**, ou retirez une ligne avec son icône de corbeille. **Tout effacer** retire, après confirmation, tous les signets de la conversation, quel que soit le filtre. Retirer un signet ne supprime jamais de message ; en cas d’échec, rien ne change et une erreur s’affiche. Les sessions archivées et les bancs en lecture seule permettent seulement de filtrer et de naviguer.

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
