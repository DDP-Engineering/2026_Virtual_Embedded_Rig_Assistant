# Autorisations

Le mode d’autorisation détermine ce que l’agent peut faire sans vous demander : modifier des fichiers, télécharger des fichiers et exécuter les programmes des plugins sur votre poste de test. La lecture du banc de travail, la recherche dans les documents et l’enregistrement d’artefacts ne demandent jamais d’approbation.

## Choisir un mode

Choisissez le mode avec **Mode d’autorisation** à côté de la zone de message. Il s’applique à cette session et peut être changé à tout moment, y compris pendant un tour. Les nouvelles sessions démarrent avec le mode par défaut du banc de travail, défini dans **Modifier le banc** → **Agent et conversation** → **Autorisations** ; un nouveau banc de travail démarre avec **Demander**.

| Mode | Modifications de fichiers | Programmes |
|---|---|---|
| **Lecture seule** | Interdites ; l’agent n’a aucun outil d’écriture | Uniquement les commandes classées **Sûr** |
| **Demander** | Chaque modification attend votre approbation | **Lecture appareil** et **Écriture appareil** demandent une approbation ; **Irréversible** demande une approbation avec un mot à saisir |
| **Modification auto** | Les modifications dans le banc de travail sont appliquées sans demande ; les téléchargements demandent toujours une approbation ; les fichiers de `.vera/` ne peuvent pas être modifiés | **Lecture appareil** s’exécute ; **Écriture appareil** demande une approbation ; **Irréversible** demande une approbation avec un mot à saisir |
| **Contournement — accès complet** | Lit et modifie des fichiers partout où votre compte a accès, sans demander | Tout sauf **Bloqué** s’exécute sans demander |

Passer à un mode plus strict annule les approbations accordées à l’agent dans le mode précédent.

## Contournement

Chaque passage à Bypass demande d’abord de confirmer que l’agent peut lire et modifier des fichiers et exécuter des programmes dans tout dossier accessible à votre compte du système, y compris hors du workbench. Choisissez **Activer Bypass** pour appliquer le changement. **Annuler** ou Échap conserve le mode précédent. Chaque nouveau passage à Bypass demande une confirmation, même après le redémarrage de VERA ; le mode sélectionné reste marqué en rouge. La même confirmation liste les règles irréversibles des plugins activés, sans erreur et qui ne sont pas à l’essai.

Le dossier des données de l’application VERA, avec les paramètres, identifiants enregistrés, plugins installés et dossiers de vérification, est refusé aux outils de fichiers de l’agent dans tous les modes, en lecture comme en écriture, y compris par des alias de chemin. VERA continue à gérer normalement ses propres paramètres et plugins. Seuls les outils activés sont disponibles ; les droits du système, les limites des outils et les approbations des plugins à l’essai restent applicables. L’agent ne peut pas modifier `.vera/workbench.yaml` ou `.vera/plugins`.

Les outils de fichiers ordinaires et les programmes déclarés peuvent accéder hors du workbench en Bypass. Le répertoire de travail peut être un chemin absolu externe ; les fichiers externes existants dans les arguments sont liés par leur chemin absolu et revérifiés avant le lancement. Ask, Auto-edit et Read-only refusent les répertoires externes et les arguments reconnus comme fichiers ou dossiers externes. Les arguments de dossiers externes sont affichés par chemin absolu, même via un alias ; leur contenu n’est pas haché. Quitter Bypass arrête ses programmes, y compris ceux en arrière-plan après la fin du tour. Les programmes enfants déclarés ne sont pas isolés dans un bac à sable. L’analyse des journaux et registres capturés, la validation et l’installation des brouillons de plugins, les entrées de candidats, les plans et micrologiciels HIL, les ressources de banc et les entrées électriques suivent aussi Bypass. Les chemins absolus externes et alias canoniques sont permis uniquement en Bypass ; les sélecteurs d’identifiants restent des identifiants. Les sources externes affichent des chemins absolus canoniques sans liens vers des documents indexés. L’installation des plugins exige toujours un examen. Les modèles et résultats électriques fixes, demandes HIL générées, index, artefacts, journaux et `.vera/` restent dans le workbench. Quitter Bypass annule les analyses et travaux HIL en cours, y compris en arrière-plan.

HIL résout les entrées relatives de plan, micrologiciel, sources et ressources depuis le répertoire de travail choisi ; les demandes et résultats générés restent dans le workbench.

## Approuver ou refuser

Lorsque l’agent a besoin de votre décision, une carte d’approbation apparaît dans la conversation et la session affiche **En attente d’approbation**.

- Pour une modification de fichier, la carte affiche le fichier et un **Diff unifié** de la modification.
- Pour un téléchargement, elle affiche l’adresse source et la taille maximale.
- Pour un programme, elle affiche le niveau de risque, le **Plugin**, la **Ligne de commande**, le **Répertoire de travail**, l’**Exécutable**, les **Notes de la règle** et les fichiers utilisés par la commande, avec des chemins absolus pour les fichiers externes, avec leur SHA-256.

Sélectionnez **Approuver** ou **Refuser**. **Approuver et passer en Modification auto** approuve et fait passer la session en **Modification auto**. Lorsque la carte a le focus, A approuve et D refuse.

Pour une commande irréversible, la carte indique que la modification est permanente et désigne un mot, généralement la commande, par exemple `burn-efuse`. Saisissez ce mot, puis approuvez. Si le mot ne correspond pas, la carte reste en attente.

## Niveaux de risque des programmes

Chaque plugin classe ses commandes. VERA compare la ligne de commande exacte à ces règles avant d’exécuter quoi que ce soit.

| Niveau | Signification |
|---|---|
| **Sûr** | Ne lit rien sur un appareil et ne modifie rien, par exemple l’affichage d’une version |
| **Lecture appareil** | Lit sur un appareil connecté, par exemple un identifiant de puce ou la mémoire |
| **Écriture appareil** | Écrit sur un appareil, par exemple pour la programmation flash ou l’effacement |
| **Irréversible** | Modifie un appareil de façon permanente, par exemple en grillant des eFuses ou en le verrouillant |
| **Bloqué** | Ne s’exécute jamais, quel que soit le mode |

Une commande qui ne correspond à aucune règle est traitée comme **Écriture appareil**. Lorsque plusieurs règles correspondent, le niveau le plus élevé s’applique. Vous pouvez voir les règles d’un plugin avant de l’installer, dans sa section **Opérations** ; consultez [Plugins](plugins.md).

## Examiner les modifications

L’onglet **Modifications** du panneau droit liste les fichiers modifiés dans la session, dans l’ordre, avec le nombre de lignes ajoutées et supprimées. Sélectionnez une entrée pour voir son diff ; **Afficher dans le dossier** montre le fichier dans votre gestionnaire de fichiers. Consultez aussi [Discussion et sessions](chat-and-sessions.md).
