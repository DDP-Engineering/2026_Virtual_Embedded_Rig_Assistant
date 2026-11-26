# Dépannage

## L’agent ne répond pas

- Ouvrez **Paramètres** → **Fournisseurs** et sélectionnez **Tester** sur la connexion utilisée par la session. L’étape en échec vous indique où chercher ; consultez [Fournisseurs et modèles](providers.md).
- **Impossible de joindre …** : le serveur local n’est pas démarré, ou l’adresse ou le réseau est incorrect.
- **Échec de l’authentification** : saisissez à nouveau la clé ou reconnectez-vous avec ChatGPT.
- **La limite de contexte a été atteinte** : raccourcissez l’entrée, démarrez une nouvelle session ou corrigez la fenêtre de contexte d’une connexion personnalisée.
- Un tour bloqué peut toujours être terminé avec **Arrêter**.

## Le banc de travail est en lecture seule

Le message **Ce banc de travail est ouvert en lecture seule, car un autre processus ou un verrou le détient.** signifie qu’un autre processus VERA a ouvert le banc de travail. Fermez-le, puis rouvrez le banc de travail. Un banc de travail situé sur un partage réseau n’est pas pris en charge ; déplacez-le sur un disque local.

## L’agent ne trouve pas une information dans les documents

1. Ouvrez l’onglet **Fichiers** et regardez l’état du document.
2. **OCR requis** : le PDF est une numérisation sans texte. Utilisez un PDF avec une couche de texte.
3. **Échec** ou **Non pris en charge** : la raison est affichée sur le document et dans **Propriétés**. Les anciens fichiers `.doc`, `.ppt` et `.xls` ne sont pas indexés.
4. Le document n’a aucun état : il se trouve en dehors des dossiers indexés. Ajoutez son dossier dans **Modifier le banc** → **Documents et RAG**, et vérifiez que ni `.vera/.veraignore` ni, si **Utiliser .gitignore** est coché, un fichier `.gitignore` ne l’exclut.
5. Sélectionnez **Réindexer**. Si l’indexation s’est arrêtée, sélectionnez **Relancer l’indexation**.

Consultez [Documents et recherche](documents-and-search.md).

## Une citation n’a pas pu être vérifiée

Le fichier cité a été modifié ou supprimé après la réponse, ou l’agent a cité quelque chose qu’il n’a pas lu. Demandez à l’agent de vérifier à nouveau.

## L’agent n’utilise pas un plugin

- Le plugin est-il activé pour ce banc de travail ? Vérifiez **Modifier le banc** → **Plugins**.
- Son **État** affiche-t-il **Prêt** ? Sinon, sélectionnez **Vérifier les dépendances**, installez ce qui manque et complétez sa **Configuration**.
- En mode **Lecture seule**, seules les commandes sûres s’exécutent ; les commandes classées **Bloqué** ne s’exécutent jamais. Consultez [Autorisations](permissions.md).
- **Non approuvé sur cette machine** ou **Les fichiers du plugin ont changé depuis son examen ; réinstallez-le.** : examinez et réinstallez le plugin.
- Un programme ne se comporte pas comme prévu : ouvrez l’onglet **Exécutions** et sélectionnez **Ouvrir le journal**.

Consultez [Plugins](plugins.md).

## Le catalogue de plugins ne s’affiche pas

Lorsque le catalogue est injoignable ou que sa signature ne correspond pas, la page **Plugins** affiche à la place les plugins fournis avec VERA. Vérifiez le réseau et l’**URL du catalogue** sous **Paramètres du catalogue**, ou utilisez **Catalogue par défaut**.

## Mises à jour

- **Mise à jour reportée jusqu’à la fin de tous les tours et approbations.** : terminez ou arrêtez les sessions en cours.
- **Le flux de mises à jour est injoignable.** : vérifiez le réseau, puis sélectionnez **Vérifier maintenant**.
- Les installations portables et Linux `.deb` n’installent pas les mises à jour elles-mêmes ; consultez [Paramètres](settings.md).

## VERA se ferme juste après le démarrage

Si le fichier `settings.json` est invalide, VERA affiche son chemin et les paramètres concernés au démarrage. Corrigez ou déplacez le fichier pour recréer les valeurs par défaut, puis configurez à nouveau vos fournisseurs et préférences.

## Journaux

VERA écrit un fichier journal par jour, `vera-YYYY-MM-DD.log`, dans le dossier `logs` de son dossier de données, et conserve les sept plus récents, ou le nombre fixé par **Conservation des journaux** dans les [paramètres avancés](advanced-settings.md). Les clés et les autres secrets connus sont retirés des journaux. La sortie des programmes des plugins ne figure pas dans ces journaux, mais dans `.vera/runs/` du banc de travail.

## Où VERA conserve ses données

Les données de l’application se trouvent dans un seul dossier :

| Installation | Dossier |
|---|---|
| Windows | `%APPDATA%\VERA\` |
| Linux | `~/.config/VERA/` |
| Portable | `data` à côté de `vera.exe` |

| Élément | Contenu |
|---|---|
| `settings.json` | Préférences, connexions aux fournisseurs sans les clés, bancs de travail récents |
| `credentials.json` | Clés et jetons de connexion, chiffrés lorsque le système le permet |
| `logs/` | Fichiers journaux quotidiens |
| `plugins/` | Plugins installés et programmes que VERA a installés pour eux |
| `window-state.json` | Taille et position de la fenêtre |

Tout ce qui appartient à un projet, comme les sessions, l’index des documents, les artefacts, les téléchargements et les journaux d’exécution, se trouve dans le dossier `.vera/` propre au banc de travail ; consultez [Bancs de travail](workbenches.md).
