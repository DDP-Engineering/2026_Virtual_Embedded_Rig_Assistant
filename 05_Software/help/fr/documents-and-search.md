# Documents et recherche

VERA indexe la documentation d’un banc de travail sur votre ordinateur, afin que l’agent puisse y faire des recherches et citer exactement la page, la section ou la ligne qu’il a utilisée. L’indexation utilise un modèle local et n’envoie rien sur le réseau. Lorsque l’agent lit un passage pour vous répondre, ce passage est transmis à votre fournisseur de modèles comme le reste de la conversation ; avec un serveur local comme LM Studio ou Ollama, il reste sur votre ordinateur.

## Ce qui est indexé

Sont indexés les dossiers cochés dans **Modifier le banc** → **Documents et RAG**, en tenant compte des motifs d’inclusion et d’exclusion définis sous **Avancé : motifs d’inclusion et d’exclusion**. Ces types de fichiers sont indexés :

- PDF
- Markdown, HTML et texte (`.txt`, `.csv`, `.tsv`)
- Fichiers Word, PowerPoint et Excel aux formats modernes (`.docx`, `.pptx`, `.xlsx`) et leurs équivalents OpenDocument (`.odt`, `.odp`, `.ods`)

Les anciens fichiers `.doc`, `.ppt`, `.xls` et RTF ne sont pas indexés ; enregistrez-les dans un format moderne. Les fichiers correspondant à `.vera/.veraignore` et tout ce qui se trouve dans `.vera`, `.git` ou `node_modules` ne sont jamais indexés. Le code source et les journaux ne sont pas indexés non plus ; l’agent les lit directement avec ses outils de fichiers.

Lorsque **Utiliser .gitignore** est coché (par défaut pour les nouveaux bancs), les fichiers et dossiers exclus par les fichiers `.gitignore` du banc ne sont pas indexés non plus : celui du dossier du banc et ceux de ses sous-dossiers, chacun pour son propre dossier, comme dans Git. Une ligne commençant par `!` dans `.vera/.veraignore` rétablit un fichier ou un dossier exclu par `.gitignore`, avec tout son contenu ; `.vera`, `.git` et `node_modules` restent ignorés. Les outils de fichiers de l’agent lisent toujours les fichiers exclus uniquement par `.gitignore`.

L’indexation s’exécute en arrière-plan et suit les changements : les fichiers nouveaux, modifiés et supprimés sont pris en compte automatiquement.

## État de l’index

L’onglet **Fichiers** du panneau droit affiche la progression (**Index : … terminés, … en attente, … en échec**) et signale l’état de chaque document :

| État | Signification |
|---|---|
| **Indexé** | Consultable par la recherche |
| **En attente** | En attente d’indexation |
| **Échec** | N’a pas pu être lu ou traité ; la raison est affichée, par exemple **Limite de taille dépassée** |
| **Non pris en charge** | Type non pris en charge, ou plus grand que la limite de taille (**Limite de taille dépassée**) |
| **OCR requis** | Un PDF numérisé sans couche de texte ; VERA n’effectue pas d’OCR |

Les fichiers PDF et Office jusqu’à 100 Mio et les fichiers texte jusqu’à 20 Mio sont indexés. **Taille maximale des fichiers (Mo)** dans **Modifier le banc** → **Documents et RAG** abaisse ces limites pour le banc (1 Mo = 1 048 576 octets) ; elle ne les relève jamais. Laissez le champ vide pour les conserver. **Réindexer** indexe à nouveau le banc de travail. Si l’indexation s’est arrêtée après des échecs répétés, sélectionnez **Relancer l’indexation**.

**Nombre maximal de fichiers indexés** dans **Modifier le banc** → **Documents et RAG** (10 000 par défaut) protège d’une sélection anormalement grande. Quand plus de documents sont sélectionnés, l’indexation ne démarre pas : l’onglet **Fichiers** affiche leur nombre, les dix dossiers contenant le plus de documents sélectionnés (sous-dossiers compris), **Indexer quand même** et **Modifier les exclusions**. Entre-temps, rien n’est indexé, modifié ni supprimé, et l’indexation ne prend jamais qu’une partie de la sélection. **Indexer quand même** les indexe tous et retient leur nombre ; une sélection ultérieure jusqu’à 20 % plus grande continue d’être indexée, une plus grande arrête à nouveau. **Modifier les exclusions** ouvre **Documents et RAG** pour restreindre la sélection.

Le nombre de documents dans **Nouveau banc de travail** et **Documents et RAG** est compté avec les mêmes règles que l’indexation (fichiers d’exclusion, limites de taille et de nombre de fichiers) et correspond donc à ce qui sera indexé. Quand la sélection dépasse **Nombre maximal de fichiers indexés**, l’avertissement y apparaît avant l’enregistrement. Sur un dossier très volumineux, le comptage s’arrête après 5 secondes ; le nombre s’affiche alors « au moins ».

Sous **Modifier le banc** → **Indexation**, **Recherche de documents** définit les valeurs par défaut de l’agent : **Résultats par recherche (1–20)** et **Mode de recherche** : **Hybride (mots-clés et sens)**, **Mots-clés uniquement** ou **Sens uniquement**.

## L’onglet Fichiers

L’onglet **Fichiers** affiche tout le dossier du banc de travail sous forme d’arborescence. Les fichiers ignorés par VERA apparaissent en italique. Le champ **Rechercher des fichiers et documents** filtre l’arborescence par nom de fichier et liste sous **Dans les documents** les passages correspondants des documents indexés.

Le menu d’un fichier propose **Ouvrir**, **Joindre comme contexte**, **Ouvrir avec** (l’application par défaut ou une autre application), **Afficher dans l’Explorateur** (le Finder ou le dossier sur les autres systèmes), **Copier** (chemin absolu, chemin relatif ou nom du fichier) et **Propriétés**, qui inclut l’état d’indexation.

## Citations

Dans une réponse, chaque puce de citation indique la source et l’emplacement : page, plage de pages, diapositive, titre ou plage de lignes. Sélectionnez une puce pour ouvrir le document à cet endroit. Une puce marquée **La citation n’a pas pu être vérifiée** désigne un élément que VERA n’a pas pu confirmer, par exemple une page qui n’existe pas ou un fichier modifié depuis ; considérez cette affirmation avec prudence.

## La visionneuse de documents

Les documents s’ouvrent dans des onglets à côté de l’onglet **Discussion**, si bien que la conversation reste où elle était. Vous pouvez passer librement de l’un à l’autre.

- Les fichiers PDF défilent en continu et affichent le numéro de page. Zoomez avec Ctrl+molette de la souris ou avec Ctrl+= , Ctrl+- et Ctrl+0.
- Ctrl+F recherche du texte dans un PDF ou un document texte ; dans les fichiers texte, Ctrl+G permet d’aller à une ligne.
- Ctrl+Tab et Ctrl+Shift+Tab passent d’un onglet à l’autre, Ctrl+W ferme l’onglet actif, et Escape revient à **Discussion**.
- Le menu d’un onglet propose **Fermer**, **Fermer les autres**, **Fermer à droite**, **Déplacer à gauche** et **Déplacer à droite**. Les onglets peuvent aussi être déplacés par glisser-déposer.

## Téléchargements

Lorsque **Accès web** est activé, l’agent peut télécharger un fichier public dans le dossier `.vera/downloads/` du banc de travail. En modes **Demander** et **Modification auto**, il demande d’abord une approbation et affiche l’adresse source et la taille maximale. Un PDF téléchargé reçoit une carte **Ouvrir le PDF** dans la conversation et apparaît sous **Fichiers téléchargés** dans l’onglet **Fichiers**. Les téléchargements ne sont pas indexés automatiquement ; pour rendre un téléchargement consultable par la recherche, copiez-le dans un dossier indexé. Consultez [Paramètres](settings.md) pour l’accès web et [Autorisations](permissions.md) pour les approbations.
