# Paramètres

**Paramètres**, en bas de la barre latérale, ouvre les paramètres de l’application. Ils s’appliquent à tous les bancs de travail ; les paramètres d’un seul banc de travail se trouvent dans **Modifier le banc** (consultez [Bancs de travail](workbenches.md)). Les modifications sont enregistrées dès que vous les effectuez, sauf sur les pages qui ont leur propre bouton **Enregistrer**. **Retour aux bancs de travail** vous ramène à votre travail.

| Page | Ce qu’elle définit |
|---|---|
| **Fournisseurs** | Accès aux modèles d’IA ; consultez [Fournisseurs et modèles](providers.md) |
| **Accès web** | Recherche et lecture sur le web pour l’agent |
| **Apparence et langue** | Langue, thème et tailles de texte |
| **Commandes** | Le shell des commandes de l’agent et des nouveaux terminaux |
| **Notifications** | Pas encore disponible |
| **Raccourcis clavier** | Vos propres combinaisons de touches |
| **Mises à jour** | La façon dont VERA se met à jour |
| **Données et confidentialité** | Valeurs de masquage par défaut pour quatre domaines |
| **À propos** | Version, environnement d’exécution, licence et composants tiers |
| **Dictée** | Modèles Whisper locaux et langue parlée |

## Données et confidentialité

Choisissez si les secrets enregistrés sont remplacés par `[REDACTED]` dans **Affichage**, **Exécutions de programmes**, **Agent et modèle** et **Artefacts et exports**. L’affichage et les exécutions sont désactivés par défaut ; l’agent et le modèle ainsi que les artefacts et exports sont activés. Seuls les secrets enregistrés connus de VERA sont masqués ; les autres textes sensibles ne sont pas détectés automatiquement. Les erreurs des fournisseurs, les tests de connexion et les journaux de diagnostic restent toujours protégés.

Utilisez **Enregistrer** ou **Annuler** en haut à droite. Les commutateurs ne modifient que le brouillon avant l’enregistrement. Désactiver **Agent et modèle** demande confirmation : les secrets enregistrés trouvés dans les fichiers ou les résultats des outils peuvent atteindre le fournisseur du modèle. Annuler ou Échap conserve le choix précédent. Les autres domaines ne demandent pas confirmation.

Dans **Modifier le banc → Données et confidentialité**, chaque domaine propose **Par défaut**, **Activé** ou **Désactivé**. Par défaut affiche la valeur actuelle de l’application et suit ses changements ; les choix explicites appartiennent au banc et voyagent avec sa configuration. Par défaut demande aussi confirmation si ce choix désactive Agent et modèle. Les nouveaux bancs héritent des valeurs de l’application sans choix explicite. Les bancs en lecture seule ne peuvent pas enregistrer de modifications.

Désactiver le masquage ne restaure pas les contenus déjà enregistrés sous `[REDACTED]`, y compris l’historique des sessions et les artefacts. Relisez ou recréez-les à partir de la source d’origine. Activer le masquage n’efface pas l’historique brut enregistré auparavant.

## Apparence et langue

- **Langue de l’interface** : **Système**, **English**, **Română**, **Deutsch** ou **Français**. **Système** utilise la langue de votre système d’exploitation lorsqu’il s’agit de l’une de ces quatre langues, et l’anglais sinon. Les dates et les nombres suivent la langue de l’interface, et l’aide s’affiche aussi dans cette langue.
- **Thème** : **Clair**, **Sombre** ou **Système**.
- Trois tailles de texte distinctes, chacune de **Très petite** à **Maximale**, avec un aperçu :
  - **Taille du texte de l’interface** : menus, libellés, boutons et la mise en page qui les entoure.
  - **Taille du texte de la conversation** : les messages d’une session.
  - **Taille du texte du code et des sorties** : blocs de code, sorties des outils et contenu des fichiers.
- **Rétablir les tailles de texte par défaut** rétablit les trois tailles à leurs valeurs par défaut.

## Raccourcis clavier

La page liste chaque commande avec sa combinaison de touches. Vous pouvez ajouter, modifier ou supprimer des combinaisons ; **Rétablir la valeur par défaut** et **Tout rétablir par défaut** annulent vos modifications. Les combinaisons utilisent Ctrl, éventuellement avec Alt ou Shift, et une lettre, un chiffre, une virgule ou une barre oblique ; VERA refuse les combinaisons réservées ou déjà attribuées. La liste par défaut figure dans [Raccourcis clavier](shortcuts.md).

## Mises à jour

- **Mode de mise à jour** : **Désactivé**, **Notifier** ou **Télécharger automatiquement**. Avec **Notifier**, VERA vous signale une nouvelle version et ne la télécharge que lorsque vous sélectionnez **Télécharger la mise à jour**.
- **Canal** : **Stable** ou **Bêta (inclut stable)**.
- **Vérifier maintenant** vérifie immédiatement, même lorsque le mode est **Désactivé**. Sinon, VERA vérifie au démarrage et toutes les six heures.

Lorsqu’une mise à jour est téléchargée, sélectionnez **Redémarrer pour mettre à jour**. VERA attend que tous les tours en cours et toutes les approbations en attente soient terminés. Chaque mise à jour est vérifiée avant son installation, et VERA n’installe jamais une version plus ancienne.

La version portable se contente d’annoncer les mises à jour : ouvrez le lien de téléchargement, puis remplacez le dossier de l’application. Une installation Linux `.deb` se met à jour via votre gestionnaire de paquets.

**Désactivé** arrête aussi la vérification quotidienne du catalogue de plugins ; **Rechercher des mises à jour** sur la page **Plugins** fonctionne toujours.

## Accès web

L’accès web permet à l’agent de faire des recherches sur le web public, de lire des pages publiques et de télécharger des fichiers publics. Il est activé par défaut, avec Exa en mode anonyme.

1. Cochez ou décochez **Activer l’accès web**.
2. Choisissez le **Fournisseur de recherche** : Exa, Tavily ou Brave.
3. Choisissez le **Mode d’accès** : **Anonyme — aucun compte requis**, ou **Utiliser ma clé API** et saisissez la clé. Brave exige toujours une clé et ne fait que rechercher ; il ne peut pas lire de pages.
4. Sélectionnez **Enregistrer**, puis **Tester la connexion**.

Seuls le texte de la recherche et les adresses demandées par l’agent quittent votre ordinateur ; VERA n’envoie aucun fichier du projet pour une recherche. L’utilisation anonyme est soumise aux limites du fournisseur. Les résultats web sont traités comme du contenu non fiable, et l’agent les cite avec leurs liens publics ; à l’ouverture d’un lien, une confirmation vous est demandée avant que votre navigateur ne l’ouvre.

La désactivation de l’accès web arrête aussi les recherches et téléchargements en cours. Chaque banc de travail peut désactiver les outils web dans **Modifier le banc** → **Outils**.

## À propos

**À propos** affiche la version de l’application, la plateforme, l’architecture, si VERA s’exécute en version portable, les paramètres régionaux du système, les versions des environnements d’exécution, la licence et la liste des composants tiers avec leurs licences.

## Commandes shell

Dans Paramètres → Commandes, choisissez Automatique, PowerShell 7, Windows PowerShell, Cmd, Bash ou Personnalisé, puis Enregistrer. Les variantes installées sont détectées dans les chemins de recherche et dossiers standards ; les variantes absentes sont désactivées. Personnalisé accepte un nom d’exécutable ou un chemin absolu. Automatique préfère PowerShell 7, Windows PowerShell puis Cmd sous Windows ; Linux préfère Bash puis sh. PowerShell exécute les commandes UTF-8 sans profil et sans interaction. Bash utilise `-lc` ; les profils peuvent modifier l’environnement. Sous Windows, Bash désigne une version native comme Git Bash ; l’ancien lanceur WSL n’est pas choisi. Cmd utilise `/d /s /c` et une ligne avec `&` ou `&&` entre commandes ; les commandes internes emploient la page de codes Windows. Pour une sortie UTF-8, utilisez PowerShell ou Bash. Le choix s’applique aux prochaines commandes de l’agent et aux nouveaux terminaux ; les terminaux existants conservent leur shell. Un shell choisi explicitement mais absent produit une erreur.

## Dictée

Choisissez **Whisper Small** (recommandé) ou **Whisper Base** (compact). La page indique la taille du téléchargement et l’état d’installation de chaque modèle. Cliquez sur **Télécharger** et suivez la progression. **Annuler** efface le téléchargement partiel. Si VERA signale un échec ou des fichiers endommagés, cliquez sur **Réessayer**. Libérez de l’espace sur le disque si nécessaire.

Après l’installation, cliquez sur **Utiliser le modèle**. VERA mémorise votre choix après redémarrage. **Supprimer** efface les fichiers du modèle et annule sa sélection s’il était actif. Si la suppression échoue, fermez les applications qui utilisent les fichiers du modèle, puis cliquez sur **Réessayer**. Les modèles sont stockés dans les données de l’application VERA et partagés entre les bancs de travail.

Sous **Langue parlée**, choisissez **Détection automatique** ou la langue que vous allez parler.

Choisissez **Maintenir pour parler** (par défaut) pour maintenir le bouton du microphone ou son raccourci en parlant. Choisissez **Appuyer pour démarrer ou arrêter** pour utiliser deux pressions séparées. Sélectionnez **Ajouter un raccourci** dans l’onglet Dictée pour définir une combinaison active dans VERA. Les combinaisons réservées ou déjà utilisées sont refusées. Le microphone reste utilisable sans raccourci.
