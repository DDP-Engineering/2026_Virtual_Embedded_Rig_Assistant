# Paramètres

**Paramètres**, en bas de la barre latérale, ouvre les paramètres de l’application. Ils s’appliquent à tous les bancs de travail ; les paramètres d’un seul banc de travail se trouvent dans **Modifier le banc** (consultez [Bancs de travail](workbenches.md)). Les modifications sont enregistrées dès que vous les effectuez, sauf sur les pages qui ont leur propre bouton **Enregistrer**. **Retour aux bancs de travail** vous ramène à votre travail.

| Page | Ce qu’elle définit |
|---|---|
| **Fournisseurs** | Accès aux modèles d’IA ; consultez [Fournisseurs et modèles](providers.md) |
| **Accès web** | Recherche et lecture sur le web pour l’agent |
| **Apparence et langue** | Langue, thème et tailles de texte |
| **Notifications** | Pas encore disponible |
| **Raccourcis clavier** | Vos propres combinaisons de touches |
| **Mises à jour** | La façon dont VERA se met à jour |
| **Données et confidentialité** | Pas encore disponible |
| **À propos** | Version, environnement d’exécution, licence et composants tiers |

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

Dans Paramètres → Commandes, saisissez le nom d’un shell installé ou son chemin absolu et choisissez Enregistrer. Videz le champ pour la sélection automatique. Windows utilise PowerShell 7, sinon Windows PowerShell, sans profil, non interactif et avec sortie UTF-8. Linux utilise `bash -lc`, sinon `sh -c` ; les profils peuvent modifier l’environnement. Un shell explicitement choisi mais indisponible produit une erreur. Windows accepte `pwsh.exe` ou `powershell.exe` ; Linux utilise `-lc` pour bash et `-c` pour les autres shells.
