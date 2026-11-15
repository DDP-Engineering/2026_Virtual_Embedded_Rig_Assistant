# Prise en main

Cette page vous guide du premier démarrage jusqu’à une première réponse avec citations. Comptez quelques minutes, plus le temps dont VERA a besoin pour indexer vos documents.

## Ce dont vous avez besoin

- VERA installé sous Windows x64 ou Linux x64. Sans réseau, consultez [Installation hors ligne](offline-install.md).
- Un accès à un modèle d’IA : une clé API OpenAI, un abonnement ChatGPT ou un serveur de modèles local comme LM Studio ou Ollama.
- Un dossier de projet sur un disque local, idéalement avec sa documentation (fiches techniques, manuels de référence, schémas au format PDF, notes en Markdown).

## Premier démarrage

VERA s’ouvre sur **Accueil**, qui affiche vos **Bancs de travail** et propose **Créer un banc de travail**. La barre latérale contient **Nouveau banc**, **Ouvrir un banc** et **Plugins** ; **Paramètres** se trouve en bas de la barre latérale.

Pour changer d’abord la langue de l’interface, ouvrez **Paramètres** → **Apparence et langue** et choisissez une **Langue de l’interface**.

## Étape 1 : connecter un fournisseur

1. Ouvrez **Paramètres** → **Fournisseurs**.
2. Choisissez l’une de ces options :
   - Abonnement ChatGPT : sous **Abonnements**, sélectionnez **Se connecter avec ChatGPT** et terminez la connexion dans votre navigateur.
   - Clé API ou serveur local : sous **Connexions API / locales**, sélectionnez **Ajouter une connexion**, choisissez le **Fournisseur** (**API OpenAI**, LM Studio, Ollama ou **Autre fournisseur compatible**), remplissez les champs et sélectionnez **Enregistrer**.
3. Sélectionnez **Tester** à côté de la connexion. Les quatre étapes (**Accessibilité**, **Authentification et modèle**, **Appel d’outils**, **Streaming**) doivent afficher **Réussi**.

Les détails figurent dans [Fournisseurs et modèles](providers.md).

## Étape 2 : créer un banc de travail

1. Sélectionnez **Nouveau banc**.
2. Sélectionnez **Choisir un dossier** et choisissez votre dossier de projet. Le nom est repris du nom du dossier.
3. Sous **Documents et RAG**, vérifiez les dossiers de documentation trouvés par VERA, ou utilisez **Ajouter un dossier…**.
4. Sélectionnez **Créer un banc de travail**.

VERA lance l’indexation en arrière-plan. Vous pouvez déjà discuter ; l’onglet **Fichiers** du panneau droit montre la progression de l’indexation. Consultez [Bancs de travail](workbenches.md) et [Documents et recherche](documents-and-search.md).

## Étape 3 : poser une première question

1. Sélectionnez **Nouvelle session**.
2. Dans les commandes de la zone de message, choisissez un **Modèle**. Laissez pour l’instant le mode d’autorisation sur **Demander**.
3. Saisissez une question sur votre projet, par exemple « Quelle est la fréquence d’horloge SPI maximale du capteur, et quelles broches utilise-t-il ? », puis appuyez sur Enter.

L’agent fait une recherche dans vos documents, lit les pages pertinentes et répond. Les puces de citation de la réponse indiquent la source ; sélectionnez-en une pour ouvrir le document à la page, au titre ou à la ligne cités.

Si l’agent veut modifier un fichier ou exécuter un programme, il vous le demande d’abord avec une carte d’approbation. Consultez [Autorisations](permissions.md).

## Étapes suivantes

- Laissez l’agent travailler avec les outils de votre poste de test : [Plugins](plugins.md).
- Découvrez le fonctionnement des sessions, de l’orientation d’un tour en cours et de l’export : [Discussion et sessions](chat-and-sessions.md).
- Réglez la taille du texte, le thème et les mises à jour : [Paramètres](settings.md).
