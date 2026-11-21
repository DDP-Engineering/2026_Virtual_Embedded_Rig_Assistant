# Documents et recherche

VERA indexe la documentation d’un banc de travail sur votre ordinateur, afin que l’agent puisse y faire des recherches et citer exactement la page, la section ou la ligne qu’il a utilisée. L’indexation et la recherche sémantique utilisent le modèle local du banc de travail. BGE Small EN v1.5 est le modèle par défaut pour l’anglais. Avec Multilingual E5 Small, le banc peut trouver des passages par leur sens en roumain, en allemand, en français et dans d’autres langues, même si la requête est dans une autre langue. Les paquets Windows et Linux contiennent les deux modèles. Vous pouvez indexer hors ligne avec l’un ou l’autre dès l’installation. Lorsque l’agent lit un passage pour vous répondre, ce passage est transmis à votre fournisseur de modèles comme le reste de la conversation ; avec un serveur local comme LM Studio ou Ollama, il reste sur votre ordinateur.

Ouvrez **Modifier le banc** → **Indexation**, choisissez le modèle et enregistrez. VERA affiche le nombre de documents indexés et demande une confirmation. Après confirmation, VERA conserve le texte extrait et recrée les vecteurs du banc en arrière-plan. La recherche par mots-clés reste disponible pendant cette opération.

Le masquage de l’affichage est désactivé par défaut. Lorsqu’il est activé pour un banc, les secrets enregistrés dans les noms de fichiers et le texte du lecteur apparaissent sous la forme [REDACTED]. Les fichiers et résultats restent listés et ouvrent le même fichier, même si deux noms masqués sont identiques. Cela ne change ni l’indexation ni ce que l’agent peut envoyer à un modèle. Les images des pages PDF conservent leurs octets d’origine ; seul le texte extrait est masqué.

## Ce qui est indexé

Sont indexés les dossiers cochés dans **Modifier le banc** → **Documents et RAG**, en tenant compte des motifs d’inclusion et d’exclusion définis sous **Avancé : motifs d’inclusion et d’exclusion**. Ces types de fichiers sont indexés :

- PDF
- Markdown, HTML et texte (`.txt`, `.csv`, `.tsv`)
- Fichiers Word, PowerPoint et Excel aux formats modernes (`.docx`, `.pptx`, `.xlsx`) et leurs équivalents OpenDocument (`.odt`, `.odp`, `.ods`)

Les anciens fichiers `.doc`, `.ppt`, `.xls` et RTF ne sont pas indexés ; enregistrez-les dans un format moderne. Les fichiers correspondant à `.vera/.veraignore` et tout ce qui se trouve dans `.vera`, `.git` ou `node_modules` ne sont jamais indexés. Le code source et les journaux ne sont pas indexés non plus ; l’agent les lit directement avec ses outils de fichiers.

Lorsque **Utiliser .gitignore** est coché (par défaut pour les nouveaux bancs), les fichiers et dossiers exclus par les fichiers `.gitignore` du banc ne sont pas indexés non plus : celui du dossier du banc et ceux de ses sous-dossiers, chacun pour son propre dossier, comme dans Git. Une ligne commençant par `!` dans `.vera/.veraignore` rétablit un fichier ou un dossier exclu par `.gitignore`, avec tout son contenu ; `.vera`, `.git` et `node_modules` restent ignorés. Les outils de fichiers de l’agent lisent toujours les fichiers exclus uniquement par `.gitignore`.

L’indexation s’exécute en arrière-plan et suit les changements : les fichiers nouveaux, modifiés et supprimés sont pris en compte automatiquement.

## État de l’index

L’onglet **Fichiers** place les icônes **Réindexer** et **Tout réduire** à côté de la recherche. Leur libellé apparaît au survol. Pendant l’indexation, une ligne compacte indique les fichiers terminés et restants ; elle disparaît après réussite. L’infobulle de réindexation conserve le nombre de documents et d’échecs. Dépliez le nombre d’échecs pour voir les fichiers et les raisons, puis choisissez **Réindexer** pour réessayer toute la sélection. Les échecs restent disponibles à la réouverture. Chaque document possède aussi son état :

| État | Signification |
|---|---|
| **Indexé** | Consultable par la recherche |
| **En attente** | En attente d’indexation |
| **Échec** | N’a pas pu être lu ou traité ; la raison est affichée, par exemple **Limite de taille dépassée** |
| **Non pris en charge** | Type non pris en charge, ou plus grand que la limite de taille (**Limite de taille dépassée**) |
| **OCR requis** | Un PDF numérisé sans couche de texte ; VERA n’effectue pas d’OCR |

Les fichiers PDF et Office jusqu’à 100 Mio et les fichiers texte jusqu’à 20 Mio sont indexés. **Taille maximale des fichiers (Mo)** dans **Modifier le banc** → **Documents et RAG** fixe la limite PDF et Office du banc, plus haute ou plus basse, jusqu’à 500 Mo (1 Mo = 1 048 576 octets) ; laissez le champ vide pour 100 Mio. La limite des fichiers texte est le paramètre avancé **Taille maximale des fichiers texte** (voir [Paramètres avancés](advanced-settings.md)). **Réindexer** indexe à nouveau le banc de travail. Si l’indexation s’est arrêtée après des échecs répétés, sélectionnez **Relancer l’indexation**.

**Nombre maximal de fichiers indexés** dans **Modifier le banc** → **Documents et RAG** (10 000 par défaut) protège d’une sélection anormalement grande. Quand plus de documents sont sélectionnés, l’indexation ne démarre pas : l’onglet **Fichiers** affiche leur nombre, les dix dossiers contenant le plus de documents sélectionnés (sous-dossiers compris), **Indexer quand même** et **Modifier les exclusions**. Entre-temps, rien n’est indexé, modifié ni supprimé, et l’indexation ne prend jamais qu’une partie de la sélection. **Indexer quand même** les indexe tous et retient leur nombre ; une sélection ultérieure jusqu’à 20 % plus grande continue d’être indexée, une plus grande arrête à nouveau. **Modifier les exclusions** ouvre **Documents et RAG** pour restreindre la sélection.

Le nombre de documents dans **Nouveau banc de travail** et **Documents et RAG** est compté avec les mêmes règles que l’indexation (fichiers d’exclusion, limites de taille et de nombre de fichiers) et correspond donc à ce qui sera indexé. Quand la sélection dépasse **Nombre maximal de fichiers indexés**, l’avertissement y apparaît avant l’enregistrement. Sur un dossier très volumineux, le comptage s’arrête après 5 secondes ; le nombre s’affiche alors « au moins ».

Sous **Modifier le banc** → **Indexation**, **Recherche de documents** définit les valeurs par défaut de l’agent : **Résultats par recherche (1–20)** et **Mode de recherche** : **Hybride (mots-clés et sens)**, **Mots-clés uniquement** ou **Sens uniquement**.

## L’onglet Fichiers

L’onglet **Fichiers** affiche tout le dossier du banc de travail sous forme d’arborescence. Les fichiers ignorés par VERA apparaissent en italique. Le champ **Rechercher des fichiers et documents** filtre l’arborescence par nom de fichier et liste sous **Dans les documents** les passages correspondants des documents indexés.

Le menu d’un fichier propose **Ouvrir**, **Joindre comme contexte**, **Ouvrir avec** (l’application par défaut ou une autre application), **Afficher dans l’Explorateur** (le Finder ou le dossier sur les autres systèmes), **Copier** (chemin absolu, chemin relatif ou nom du fichier) et **Propriétés**, qui inclut l’état d’indexation.

## État Git dans Fichiers

Activez **Afficher l’état Git dans Fichiers** dans **Modifier le banc de travail → Interface**, puis enregistrez. L’option est désactivée par défaut pour chaque banc. Fichiers affiche la branche et compte les chemins modifiés et les conflits du banc. Un renommage compte les deux chemins s’ils sont tous les deux dans le banc. S’il traverse la limite du banc, il apparaît comme un ajout ou une suppression du côté visible.

**I** indique une modification dans l’index et **T** une modification dans l’arbre de travail. Les codes sont M (modifié), ? (non suivi), A (ajouté), R (renommé), D (supprimé) et ! (conflit). Un fichier peut avoir les deux marques. Un dossier replié indique le nombre de chemins modifiés. **Modifications Git uniquement** filtre l’arborescence. Les fichiers supprimés et les anciens chemins des renommages restent visibles sans fichier à ouvrir.

L’état applique les règles d’exclusion de Git, même si l’indexation des documents suit d’autres règles. Il s’actualise quand les fichiers surveillés changent. Utilisez **Actualiser l’état Git** après une erreur ou pour les dossiers qui ne peuvent pas être surveillés. Cette vue en lecture seule nécessite une installation système de Git 2.40 ou ultérieur et un arbre de travail local ordinaire. Les arbres de travail liés, les sous-modules utilisés comme racine du banc, les formats de métadonnées non pris en charge et les dépôts dont la configuration contient des inclusions ou des filtres affichent un état indisponible. La navigation dans Fichiers reste disponible.

Ouvrez le menu contextuel d’un fichier modifié (clic droit ou **Maj+F10**), puis choisissez **Git → Voir les modifications hors index** ou **Voir les modifications indexées**. La première option compare l’arbre de travail à l’index. La seconde compare l’index à HEAD, ou à une base vide si la branche n’a aucun commit. Chaque comparaison s’ouvre dans son propre onglet à côté du Chat. Changez d’onglet avec **Ctrl+Page précédente/suivante** et fermez la comparaison active avec **Ctrl+W**. Le brouillon et la position dans la conversation sont conservés.

Dans le menu contextuel d’un fichier suivi, choisissez **Git → Voir l’historique du fichier**. L’option est aussi disponible pour les fichiers inchangés et les suppressions suivies visibles dans Fichiers. L’onglet central affiche jusqu’à 50 commits accessibles depuis le HEAD local, du plus récent au plus ancien, avec l’identifiant court, l’auteur, la date et l’objet. Git suit les renommages détectés dans le banc de travail. Les déplacements qui en franchissent la limite sont omis. La vue utilise les données locales et respecte le réglage de masquage de l’affichage.

Ces comparaisons en lecture seule sont disponibles pour les chemins supprimés et les renommages à l’intérieur du banc de travail. Un message signale un conflit, un fichier binaire, une comparaison trop volumineuse ou un contenu indisponible. Ouvrez les fichiers non suivis dans la visionneuse habituelle.

## Citations

Dans une réponse, chaque puce de citation indique la source et l’emplacement : page, plage de pages, diapositive, titre ou plage de lignes. Sélectionnez une puce pour ouvrir le document à cet endroit. Une puce marquée **La citation n’a pas pu être vérifiée** désigne un élément que VERA n’a pas pu confirmer, par exemple une page qui n’existe pas ou un fichier modifié depuis ; considérez cette affirmation avec prudence.

## La visionneuse de documents

Les documents s’ouvrent dans des onglets à côté de l’onglet **Discussion**, si bien que la conversation reste où elle était. Vous pouvez passer librement de l’un à l’autre.

Les fichiers texte jusqu’à 5 Mio proposent **Encodage** et **Retour à la ligne**. Les BOM UTF-8 et UTF-16 sont détectés ; sans BOM, UTF-8 est utilisé. Choisissez Windows-1252, ISO-8859-1, ISO-8859-2 ou UTF-16 LE/BE au besoin. Chromium décode ISO-8859-1 via son alias Windows-1252. **Afficher en texte** affiche les octets invalides comme caractères de remplacement. Recherche et saut à la ligne utilisent les lignes source numérotées même avec le retour à la ligne. Ces commandes ne modifient ni le fichier, ni l’indexation, ni la vérification des citations. Si le masquage est actif, le texte ordinaire remplace les octets secrets par des astérisques (les paires UTF-16 apparaissent comme ⨪) ; noms et citations rendues utilisent [REDACTED].

Les grands fichiers sont lus par fenêtres. La barre tout à droite choisit une position en octets ; la barre intérieure parcourt la fenêtre courante. Ctrl+Home/End rejoint le début/la fin du fichier. Les numéros avec ≈ sont estimés jusqu’à leur précision par l’indexation progressive. Le saut à une ligne est d’abord approximatif, puis exact. La recherche parcourt les fenêtres ; Enter trouve le résultat suivant, Shift+Enter le précédent, et **Annuler** arrête l’analyse. Les très longues lignes apparaissent en fragments bornés marqués … ; le défilement passe au fragment suivant. La recherche compte les lignes correspondantes et reprend à l’autre extrémité. Les grandes citations gardent leur plage vérifiée.

- Les fichiers PDF défilent en continu et affichent le numéro de page. Zoomez avec Ctrl+molette de la souris ou avec Ctrl+= , Ctrl+- et Ctrl+0.
- Ctrl+F recherche du texte dans un PDF ou un document texte ; dans les fichiers texte, Ctrl+G permet d’aller à une ligne.
- Ctrl+Tab et Ctrl+Shift+Tab passent d’un onglet à l’autre, Ctrl+W ferme l’onglet actif, et Escape revient à **Discussion**.
- Le menu d’un onglet propose **Fermer**, **Fermer les autres**, **Fermer à droite**, **Déplacer à gauche** et **Déplacer à droite**. Les onglets peuvent aussi être déplacés par glisser-déposer.

## Téléchargements

Lorsque **Accès web** est activé, l’agent peut télécharger un fichier public dans le dossier `.vera/downloads/` du banc de travail. En modes **Demander** et **Modification auto**, il demande d’abord une approbation et affiche l’adresse source et la taille maximale. Un PDF téléchargé reçoit une carte **Ouvrir le PDF** dans la conversation et apparaît sous **Fichiers téléchargés** dans l’onglet **Fichiers**. Les téléchargements ne sont pas indexés automatiquement ; pour rendre un téléchargement consultable par la recherche, copiez-le dans un dossier indexé. Consultez [Paramètres](settings.md) pour l’accès web et [Autorisations](permissions.md) pour les approbations.

## Vue hexadécimale

Dans le menu d’un fichier sous **Fichiers**, choisissez **Afficher en hexadécimal**. Chaque ligne en lecture seule présente le décalage physique, jusqu’à 16 octets et les caractères ASCII imprimables ; les autres octets apparaissent comme des points. La dernière ligne peut être plus courte. Le curseur de position parcourt tout le fichier ; la barre intérieure parcourt une fenêtre limitée.

**Aller au décalage** (Ctrl+G) accepte une position décimale ou hexadécimale préfixée par `0x`, de zéro au dernier octet. **Rechercher** (Ctrl+F) cherche des **Octets hexadécimaux** comme `41 42 00 FF`, avec des espaces facultatifs, ou du **Texte UTF-8** sensible à la casse. Entrée trouve l’occurrence suivante et reprend au début après la fin. La recherche accepte au plus 4 096 octets. **Annuler**, Échap ou une nouvelle requête interrompt le parcours ; Échap ferme les champs et rend le focus aux octets.

Un clic sélectionne un octet ; glisser ou Maj+clic étend la sélection, même entre fenêtres. Les flèches déplacent la sélection, Maj+flèches l’étend, Page précédente/suivante déplace d’un écran et Ctrl+Début/Fin atteint les extrémités. **Copier en hexadécimal** (Ctrl+C) copie les octets en majuscules séparés par des espaces. **Copier en texte** (Ctrl+Maj+C) décode UTF-8 avec des caractères de remplacement. La limite est de 64 Kio par sélection ; choisissez une plage plus petite en cas de dépassement. Le masquage remplace les octets secrets par `2A` (astérisque) ; recherche et copie utilisent ces mêmes octets masqués. Les erreurs proposent **Réessayer**.

## Modes d’affichage

Choisissez **Rendu**, **Texte** ou **Hex** dans la barre du fichier. Le rendu est proposé pour les PDF, Markdown, HTML et formats Office pris en charge et indexés. Markdown et HTML non indexés ou ignorés ouvrent en Texte ; les formats binaires sans rendu disponible ouvrent en Hex. Ces choix par défaut ne remplacent pas votre préférence enregistrée. Les fichiers binaires ou inconnus s’ouvrent automatiquement en Hex. Choisissez Texte pour un format inconnu ; les réglages d’encodage et de remplacement restent disponibles. Ce choix est mémorisé par extension, même après le redémarrage de VERA. L’ouverture dans l’application par défaut reste dans le menu de l’onglet. Les citations gardent leur vue et leur plage vérifiées ; les artefacts, téléchargements et journaux conservent leurs propres vues.

## Aperçu des images

Les fichiers PNG, JPEG, GIF, WebP, BMP et SVG ouvrent en **Rendu** sans indexation. **Zoom de l’image** commence par **Ajuster** : les grandes images sont réduites à l’espace disponible, les petites ne sont pas agrandies. Ajuster suit la taille du panneau. Choisissez de 25% à 400% pour redimensionner l’image décodée d’origine, puis revenez à Ajuster. Le SVG reste une image : scripts, liens et ressources externes sont inactifs. **Texte** et **Hex** restent accessibles ; le choix explicite est mémorisé par extension.

Les octets suivent le masquage Affichage actuel. Celui-ci peut empêcher le décodage ; une image incompatible ou corrompue affiche aussi une erreur sûre avec **Réessayer**. Utilisez Hex pour examiner les octets reçus. L’aperçu assemble des fenêtres bornées en une ressource image complète du navigateur. La mémoire requise dépend donc de la taille encodée et décodée et des ressources du décodeur. Aucune limite fixe de taille du fichier n’est imposée.

## État de l’indexation

L’icône à côté du nom du banc de travail actif indique l’état de l’analyse, de l’indexation ou de la reconstruction. Placez-y le focus ou le pointeur pour consulter les compteurs, puis activez-la pour ouvrir Fichiers. Le total des fichiers traités comprend les fichiers ignorés, ceux qui nécessitent une reconnaissance par OCR et les échecs. Les documents interrogeables ont des passages dans l’index. Le total reste inconnu tant que la sélection n’est pas déterminée. Dans un banc de travail en lecture seule, VERA peut utiliser l’index enregistré sans le vérifier à nouveau. Fichiers indique les motifs des exceptions et permet de gérer la limite de fichiers ou de redémarrer le service d’indexation.

Le chat signale les réponses pour lesquelles la recherche a été partielle, s’est rabattue sur les mots-clés ou était indisponible. Une recherche partielle sans résultat peut manquer des sources en attente ou exclues. Vous pouvez poursuivre la conversation ou ouvrir un fichier connu pendant la mise à jour de l’index.
