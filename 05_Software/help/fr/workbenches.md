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
| **Documents et RAG** | Les dossiers et fichiers indexés |
| **Agent et conversation** | Modèle par défaut, mode d’autorisation par défaut, **Niveau de détail** |
| **Instructions** | Le texte de `.vera/WORKBENCH.md`, que l’agent lit dans chaque session |
| **Outils** | Les outils intégrés que l’agent peut utiliser |
| **Compétences** | Compétences du banc de travail et de l’utilisateur : les activer, les créer et les modifier |
| **Indexation** | Paramètres d’embedding et valeurs par défaut de la recherche de documents de l’agent |
| **Plugins** | Les plugins installés que ce banc de travail active |

Gardez des instructions courtes et factuelles : la carte, le microcontrôleur, la chaîne de compilation, les conventions. Seuls les 16 premiers Ko sont transmis à l’agent ; VERA vous avertit lorsque le texte est plus long.

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
