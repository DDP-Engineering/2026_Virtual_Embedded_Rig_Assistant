# Bancs de travail

Un banc de travail est un dossier de projet dans lequel VERA travaille : sources, fiches techniques, schémas, journaux et notes. VERA conserve ses propres données pour ce dossier dans un sous-dossier `.vera/` et ne déplace ni ne convertit vos autres fichiers. Chaque banc de travail a ses propres sessions, son propre index de documents, ses propres instructions et ses propres plugins activés.

## Créer un banc de travail

1. Sélectionnez **Nouveau banc** dans la barre latérale.
2. Sous **Général**, sélectionnez **Choisir un dossier** et choisissez le dossier. **Nom du banc de travail** est repris du nom du dossier ; modifiez-le si vous le souhaitez.
3. Sous **Documents et RAG**, vérifiez les dossiers de documentation trouvés par VERA, ou sélectionnez **Ajouter un dossier…**. La ligne d’aperçu indique combien de documents seront indexés. **Avancé : motifs d’inclusion et d’exclusion** permet de modifier directement les motifs.
4. Ajustez éventuellement les autres sections (voir le tableau ci-dessous).
5. Sélectionnez **Créer un banc de travail** en haut à droite.

Si le dossier est déjà un banc de travail, VERA propose **Ouvrir ce banc de travail** à la place. Un fichier `.vera/WORKBENCH.md` existant est conservé tel quel.

Utilisez un dossier sur un disque local. Les partages réseau ne sont pas pris en charge.

## Bancs de travail ouverts, récents et épinglés

- **Ouvrir un banc** ouvre un dossier qui contient déjà `.vera/workbench.yaml`.
- La barre latérale liste vos bancs de travail récents. Les bancs de travail épinglés restent en haut.
- Chaque ligne a un menu **Actions du banc de travail** : **Épingler** ou **Désépingler**, **Monter**, **Descendre**, **Modifier le banc**, **Ouvrir dans l’Explorateur**, **Fermer le banc de travail** et **Retirer de la liste**.
- **Retirer de la liste** retire uniquement l’entrée ; aucun fichier n’est supprimé.
- Si un dossier a été déplacé ou supprimé, son entrée affiche **Dossier introuvable**. Retirez-le de la liste ou ouvrez le dossier à son nouvel emplacement.
- **Afficher les sessions** et **Masquer les sessions** développent ou réduisent les sessions d’un banc de travail dans la barre latérale.

Sélectionnez le nom d’un banc de travail pour afficher sa **Vue d’ensemble du banc de travail** : le modèle de conversation, le mode d’autorisation, les sources indexées et exclues, et les sessions.

## Modifier un banc de travail

Sélectionnez **Modifier le banc** dans la vue d’ensemble ou dans le menu de la ligne. Modifiez les sections, puis sélectionnez **Enregistrer** en haut à droite ; **Annuler** abandonne vos modifications. Si vous quittez la page avec des modifications non enregistrées, VERA vous le demande d’abord.

| Section | Ce qu’elle définit |
|---|---|
| **Général** | Nom et description |
| **Interface** | Visibilité des **Onglets du panneau droit** |
| **Documents et RAG** | Les dossiers et fichiers indexés |
| **Agent et conversation** | Modèle par défaut, mode d’autorisation par défaut, **Niveau de détail** |
| **Instructions** | Le texte de `.vera/WORKBENCH.md`, que l’agent lit dans chaque session |
| **Outils** | Les outils intégrés que l’agent peut utiliser |
| **Compétences** | Compétences du banc de travail et de l’utilisateur : les activer, les créer et les modifier |
| **Indexation** | Paramètres d’embedding et valeurs par défaut de la recherche de documents de l’agent |
| **Plugins** | Les plugins installés que ce banc de travail active |

Gardez des instructions courtes et factuelles : la carte, le microcontrôleur, la chaîne de compilation, les conventions. Seuls les 16 premiers Ko sont transmis à l’agent ; VERA vous avertit lorsque le texte est plus long.

## Compétences

Les compétences sont des instructions réutilisables pour l’agent, pas des commandes. Ouvrez **Modifier le banc > Compétences** ou **Compétences** dans l’onglet **Instructions et compétences** de la session. **Activée** rend les instructions disponibles dans ce banc sans les exécuter. L’activation est enregistrée immédiatement ; fermer le panneau ou annuler d’autres modifications du banc ne l’annule pas.

Choisissez **Créer une compétence**, saisissez un nom composé de minuscules (a–z), chiffres et tirets (1–64 caractères), puis **Ce banc de travail** ou **Tous mes bancs de travail**. Ce dernier choix utilise le profil VERA actuel, sans partage automatique avec d’autres utilisateurs ou installations. **Créer et modifier** ouvre un modèle : complétez la description et la procédure, puis enregistrez. **Annuler** abandonne les modifications inachevées, pas la compétence déjà créée.

Les compétences du banc et de l’utilisateur proposent **Modifier les instructions**. Les compétences officielles et des plugins proposent **Voir les instructions** en lecture seule. **Actualiser la liste** relit la liste ; **Réessayer** n’apparaît qu’après un échec et répète l’opération concernée. Un banc en lecture seule permet d’actualiser et de consulter, mais pas de modifier. **Fermer** ou Échap ferme le dialogue ; Échap abandonne d’abord le formulaire de création ou d’édition ouvert.

## Onglets du panneau droit

Ouvrez **Modifier le banc > Interface > Onglets du panneau droit**. Sélectionnez les onglets visibles : Instructions et compétences, Fichiers, Modifications, Artefacts, Plan, Exécutions et Terminal. Tous sont sélectionnés par défaut. **Rétablir les valeurs par défaut** les sélectionne dans le brouillon ; **Enregistrer** applique le choix et **Annuler** l’abandonne.

L’enregistrement actualise immédiatement toutes les sessions de ce banc, même après réouverture ou redémarrage de VERA. Les autres bancs conservent leur propre sélection. Masquer l’onglet actif sélectionne le premier onglet restant dans l’ordre habituel. Tous les masquer ferme le panneau et supprime son bouton d’ouverture habituel. **Onglets du panneau droit** reste accessible sur la page principale ; l’éditeur reste disponible depuis la vue d’ensemble et le menu latéral.

Les flèches, Début et Fin ne parcourent que les onglets visibles. Le raccourci du terminal ne révèle jamais un onglet masqué et propose un lien vers ces paramètres. Le masquage ne change que l’affichage : instructions, fichiers, modifications, artefacts, plans et historique sont conservés, les outils de l’agent fonctionnent toujours et les terminaux et programmes actifs continuent. Fermer reste disponible lorsque le panneau est affiché et n’est pas un onglet configurable.

## Bancs de travail en lecture seule

Un banc de travail s’ouvre en lecture seule lorsqu’un autre processus VERA l’a déjà ouvert, par exemple une seconde installation de VERA. Vous pouvez lire les sessions, parcourir et ouvrir des fichiers et exporter des sessions, mais vous ne pouvez ni envoyer de messages ni enregistrer de paramètres. Fermez l’autre instance et rouvrez le banc de travail pour y travailler.

## Le dossier .vera

| Élément | Contenu |
|---|---|
| `workbench.yaml` | La configuration du banc de travail ; modifiez-la avec **Modifier le banc** |
| `WORKBENCH.md` | Les instructions destinées à l’agent |
| `.veraignore` | Règles facultatives pour les fichiers que l’agent et l’index ne doivent pas voir |
| `skills/` | Compétences de ce banc de travail |
| `plugins/` | Paquets de plugins partagés avec le projet |
| `vera.db` | Sessions, approbations, modifications et index des documents |
| `artifacts/`, `downloads/`, `runs/` | Artefacts des sessions, fichiers téléchargés, journaux d’exécution des programmes |

`.vera/` contient un `.gitignore` qui ne garde sous contrôle de version que la configuration, les instructions, `.veraignore` et les compétences. L’agent ne peut pas modifier `workbench.yaml` ni `.vera/plugins`, quel que soit le mode d’autorisation.

`.veraignore` utilise la même syntaxe de motifs que `.gitignore`. Les dossiers `.vera`, `.git` et `node_modules` sont toujours ignorés.

## Dossiers supplémentaires

Dans **Modifier le banc > Général > Dossiers supplémentaires**, choisissez **Ajouter un dossier**, puis un dossier absolu, par exemple un dépôt voisin. **Enregistrer** accorde l’accès ; **Annuler** abandonne la sélection. La vue d’ensemble liste les dossiers enregistrés. Supprimez un dossier et enregistrez pour révoquer immédiatement l’accès, y compris pour les opérations en attente. Un banc en lecture seule ne peut pas modifier ces autorisations.

Les outils ordinaires read, list, glob, grep, write et edit ainsi que les dossiers de travail shell utilisent ces dossiers avec les mêmes accords Demander ou Modification auto que le banc. Les chemins externes doivent être absolus ; les chemins relatifs partent toujours du banc principal. Les sources externes ont une identité absolue, sans citation locale de document. Les règles d’exclusion restent actives ; les données VERA sont refusées même via des liens. L’ajout n’indexe pas ces dossiers : index, journaux, artefacts et données générées restent dans le banc principal. Les commandes gardent les droits du compte système, sans bac à sable.

## Données et confidentialité

Choisissez Par défaut, Activé ou Désactivé pour chaque domaine de masquage, puis Enregistrer ou Annuler en haut à droite. Par défaut affiche et suit la valeur de l’application ; les choix restent indépendants entre les bancs. Consultez les [Paramètres](settings.md) pour l’avertissement sur le fournisseur du modèle et les limites de l’historique enregistré.
