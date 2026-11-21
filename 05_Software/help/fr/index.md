# Aide de VERA

VERA, le Virtual Embedded Rig Assistant, est une application de bureau qui sert de banc de travail aux ingénieurs en systèmes embarqués. Vous ouvrez un dossier de projet comme banc de travail, et VERA indexe sur votre ordinateur ses fiches techniques, manuels et notes. Un agent IA répond à vos questions sur le projet et cite les pages qu’il a utilisées ; une citation ouvre le document à cet endroit. Grâce aux plugins, l’agent peut aussi exécuter les outils de votre poste de test, comme des outils de programmation flash, des moniteurs série ou des débogueurs, toujours dans le mode d’autorisation que vous choisissez.

## Ouvrir l’aide

- Sélectionnez **Aide**, le point d’interrogation dans la barre supérieure, à côté de **Afficher/masquer le panneau droit**.
- Appuyez sur F1 pour ouvrir la page d’aide de l’écran sur lequel vous vous trouvez.

L’aide affiche la liste des pages et la page sélectionnée. Les liens entre les pages ouvrent la page liée dans l’aide.

L’aide est installée avec VERA et fonctionne donc sans réseau. Elle s’affiche dans la langue de l’interface. Lorsqu’une page n’existe pas dans cette langue, la page anglaise s’affiche à la place.

## Interroger l’agent

L’agent peut lui aussi lire ces pages d’aide. Dans n’importe quelle session, demandez par exemple « Comment activer un plugin dans VERA ? » ou « Comment exporter une session dans VERA ? », et il cherche la réponse dans l’aide.

## Aide des plugins

Chaque plugin installé possède sa propre page d’aide : ce que fait le plugin, ce dont il a besoin et comment demander à l’agent de l’utiliser. Vous la trouvez dans l’aide, dans la liste des pages, et sur la carte du plugin dans la page **Plugins**.

## Pages

| Page | Contenu |
|---|---|
| [Prise en main](getting-started.md) | Premier démarrage, un fournisseur, un premier banc de travail, une première question |
| [Bancs de travail](workbenches.md) | Créer, ouvrir, épingler et modifier des bancs de travail ; bancs de travail en lecture seule ; le dossier `.vera/` |
| [Discussion et sessions](chat-and-sessions.md) | Sessions, orientation d’un tour en cours, archivage, export, niveaux de détail, raisonnement |
| [Autorisations](permissions.md) | Lecture seule, Demander, Modification auto et Contournement ; approbations, modifications et niveaux de risque |
| [Documents et recherche](documents-and-search.md) | Indexation, recherche, citations, visionneuse de documents, téléchargements |
| [Fournisseurs et modèles](providers.md) | OpenAI, abonnement ChatGPT, LM Studio, Ollama et autres points de terminaison |
| [Plugins](plugins.md) | Catalogue, installation, examen et confiance, dépendances, configuration, packs |
| [Paramètres](settings.md) | Apparence, langue, mises à jour, accès web, raccourcis clavier |
| [Paramètres avancés](advanced-settings.md) | Limites réglables par application, banc ou session |
| [Raccourcis clavier](shortcuts.md) | Tous les raccourcis clavier de VERA |
| [Installation hors ligne](offline-install.md) | Installer VERA et les plugins sur un ordinateur sans réseau |
| [Dépannage](troubleshooting.md) | Problèmes courants, journaux et emplacement des données de VERA |

## À propos de VERA

La version, les versions des environnements d’exécution, la licence et les composants tiers se trouvent dans **Paramètres** → **À propos**.
