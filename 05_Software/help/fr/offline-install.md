# Installation hors ligne

VERA peut être installé et utilisé sur un ordinateur de laboratoire sans réseau. Le programme d’installation contient tout ce dont l’application a besoin : le modèle d’indexation local, l’installateur d’outils Python et le catalogue officiel de plugins. Les programmes exécutés par les plugins sont fournis séparément, dans un kit de dépendances hors ligne. Le navigateur interactif et les modèles de dictée sont eux aussi livrés à part, dans le dossier `components/`. Les modèles d’IA ont toujours besoin d’un fournisseur : sur un ordinateur sans réseau, utilisez un serveur local comme LM Studio ou Ollama (consultez [Fournisseurs et modèles](providers.md)).

## Le dossier de livraison

Une livraison de VERA est un dossier par version, `vera-<version>/` :

| Dossier | Contenu |
|---|---|
| `vera-windows-x64/` | `VERA-<v>-win-x64.exe` (programme d’installation), `VERA-<v>-win-x64.zip` (portable), `SHA256SUMS` |
| `vera-linux-x64/` | `VERA-<v>-linux-*.AppImage`, `VERA-<v>-linux-*.deb`, `SHA256SUMS` |
| `plugins/` | Un `<id>-<version>.zip` par plugin, les index du catalogue, `vera-plugins-<version>.zip` avec tout le catalogue, `SHA256SUMS` |
| `plugin-deps/` | `vera-plugin-deps-<version>-windows-x64.zip` et `…-linux-x64.zip`, `SHA256SUMS` |
| `components/` | `chrome-win64.zip` et `chrome-linux64.zip` (navigateur), `whisper-base.zip` et `whisper-small.zip` (modèles de dictée), `THIRD-PARTY-NOTICES.md`, `SHA256SUMS` |
| `delivery.json` | Ce qui a été construit : versions, fichiers, tailles et SHA-256 |

Copiez le dossier de votre plateforme, ainsi que `plugin-deps/` si vous voulez utiliser les programmes des plugins. `plugins/` n’est nécessaire que pour les plugins plus récents que votre programme d’installation de VERA. Le kit de dépendances pèse environ 1 Go par plateforme. Copiez aussi `components/` si vous voulez le navigateur interactif ou la dictée. Ce dossier fait environ 700 Mo pour les deux plateformes et les deux modèles.

## 1. Vérifier les fichiers

Comparez chaque fichier avec sa ligne dans `SHA256SUMS` :

- Linux : exécutez `sha256sum -c SHA256SUMS` dans chaque dossier.
- Windows (PowerShell) : exécutez `Get-FileHash <file> -Algorithm SHA256` et comparez le hachage avec la ligne de `SHA256SUMS`.

N’installez pas un fichier dont le hachage diffère ; copiez-le à nouveau.

## 2. Installer VERA

- Programme d’installation Windows : exécutez `VERA-<v>-win-x64.exe`. Il installe VERA pour votre utilisateur et ne nécessite pas de droits d’administrateur.
- Version portable Windows : extrayez `VERA-<v>-win-x64.zip` et démarrez `vera.exe`. Ses paramètres et ses données restent dans le dossier `data` situé à côté.
- Linux : `sudo apt install ./VERA-<v>-linux-amd64.deb`, ou rendez l’AppImage exécutable avec `chmod +x` et lancez-la.
- Avec un réseau, ajoutez le dépôt apt VERA pour que `sudo apt upgrade` mette aussi à jour une installation `.deb` : voir [Paramètres](settings.md), **Mises à jour**.

## 3. Installer les plugins

La page **Plugins** liste les plugins officiels de votre version de VERA à partir du catalogue inclus dans le programme d’installation ; installez-les depuis cette page comme d’habitude (consultez [Plugins](plugins.md)). Pour un plugin plus récent de la livraison, sélectionnez **Installer depuis un zip…** et choisissez `plugins/<id>-<version>.zip`.

## 4. Préparer les programmes des plugins pour le hors ligne

1. Extrayez `vera-plugin-deps-<version>-<platform>.zip` dans un dossier local. Le dossier extrait contient `kit.json`.
2. Fermez VERA.
3. Ouvrez le fichier `settings.json` de VERA dans un éditeur de texte. Il se trouve dans `%APPDATA%\VERA\` sous Windows, dans `~/.config/VERA/` sous Linux, ou dans le dossier `data` de la version portable.
4. Ajoutez le paramètre `plugins.kit` avec le chemin absolu du dossier extrait, par exemple :

   ```json
   "plugins": { "kit": "D:\\vera-plugin-deps-<version>-windows-x64" }
   ```

   Si `settings.json` contient déjà une entrée `plugins`, ajoutez `kit` à l’intérieur. En JSON, écrivez chaque barre oblique inverse deux fois.
5. Démarrez VERA, ouvrez le plugin sur la page **Plugins** et sélectionnez **Installer les dépendances**.

VERA vérifie chaque fichier du kit par rapport au SHA-256 du manifeste du plugin et refuse tout fichier modifié. Pour installer à nouveau depuis le réseau, supprimez `plugins.kit`.

Pour installer un seul programme à partir d’une archive que vous avez copiée vous-même, utilisez plutôt **Installer depuis une archive de dépendances…** sur la carte du plugin.

## 5. Installer le navigateur et les modèles de dictée hors ligne

1. Ouvrez **Paramètres → Accès web** et sélectionnez **Installer depuis un fichier…**. Choisissez `components/chrome-win64.zip` sous Windows ou `components/chrome-linux64.zip` sous Linux.
2. Ouvrez **Paramètres → Dictée** et sélectionnez **Installer depuis un fichier…** sur le modèle souhaité. Choisissez `components/whisper-base.zip` ou `components/whisper-small.zip`.

VERA vérifie chaque fichier avec le SHA-256 fixé par sa version, refuse un fichier modifié ou différent et n’envoie aucune requête réseau. `THIRD-PARTY-NOTICES.md` indique la source et la licence de chaque composant.

## Programmes des fabricants

Les programmes des fabricants, comme KiCad, LTspice ou STM32CubeProgrammer, ne font jamais partie du kit. Le fichier `README.md` du kit liste chacun d’eux avec sa page de téléchargement. Installez-les avec le programme d’installation du fabricant, puis sélectionnez **Vérifier les dépendances** sur le plugin.
