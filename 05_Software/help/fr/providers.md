# Fournisseurs et modèles

Un fournisseur donne à VERA l’accès à un modèle de langage. Il vous en faut au moins un. Configurez les fournisseurs dans **Paramètres** → **Fournisseurs**, qui comporte deux parties : **Abonnements** et **Connexions API / locales**.

## Abonnement ChatGPT

1. Sous **Abonnement ChatGPT**, sélectionnez **Se connecter avec ChatGPT**. Le navigateur de votre système ouvre la page de connexion.
2. Connectez-vous sur cette page. VERA affiche **Connecté avec ChatGPT** une fois l’opération terminée.

Le jeton est renouvelé automatiquement. **Se déconnecter** le supprime.

- Si la connexion n’aboutit pas, collez l’adresse finale du navigateur dans **Collez l’URL de redirection finale si la connexion n’aboutit pas** et sélectionnez **Terminer la connexion**.
- La connexion expire au bout de 10 minutes.
- Si le port 1455 est occupé, une connexion dans Codex CLI est souvent encore ouverte. Annulez-la et réessayez.

## API OpenAI

1. Sous **Connexions API / locales**, sélectionnez **Ajouter une connexion** et choisissez **API OpenAI** comme **Fournisseur**.
2. Saisissez la **Clé API OpenAI** et, si vous le souhaitez, un **Modèle OpenAI**.
3. Sélectionnez **Enregistrer**.

## LM Studio

1. Démarrez le serveur LM Studio et chargez un modèle.
2. **Ajouter une connexion**, **Fournisseur** LM Studio. L’adresse `http://localhost:1234` est préremplie.
3. Sélectionnez **Tester la connexion**. VERA lit les modèles de conversation du serveur ; les modèles d’embedding sont ignorés.
4. Pour chaque modèle, vérifiez la limite de contexte affichée par VERA. Si le serveur n’en indique aucune, définissez-la vous-même. Les valeurs facultatives **Raisonnement** et **Température** restent sur **Valeur par défaut du fournisseur** si vous ne les définissez pas.
5. Sélectionnez **Enregistrer**.

Pour LM Studio, une clé API est facultative.

## Ollama et autres points de terminaison compatibles

1. **Ajouter une connexion**, **Fournisseur** Ollama ou **Autre fournisseur compatible**. Pour Ollama, l’**URL de base** `http://localhost:11434/v1` est préremplie.
2. Renseignez **Nom du point de terminaison**, **URL de base** (une adresse `http` ou `https` se terminant par `/v1`), **Modèle** (le nom du modèle tel que le serveur le connaît), **Fenêtre de contexte (jetons)** et **Sortie maximale (jetons)**.
3. Saisissez une **Clé API du point de terminaison** si le serveur en exige une, ou laissez le champ vide.
4. Sélectionnez **Enregistrer**.

Reprenez la fenêtre de contexte de la documentation du modèle ou des paramètres de votre serveur. Une valeur trop grande provoque des erreurs du serveur ; une valeur trop petite amène VERA à résumer l’historique plus tôt que nécessaire.

## Prise en charge des images

VERA lit la prise en charge des images dans les catalogues de modèles ChatGPT et de l’API OpenAI. Pour LM Studio, Ollama ou un autre point de terminaison compatible, sélectionnez ou saisissez le modèle. S’il prend en charge les images en entrée, activez **Accepte les images**, puis sélectionnez **Enregistrer**. L’option est désactivée par défaut pour chaque modèle.

Une image envoyée à un modèle quitte votre ordinateur si le fournisseur est distant. Le masquage du texte s’applique aux chemins des images selon vos réglages. Le modèle reçoit directement les pixels de l’image.

## Tester une connexion

**Tester** exécute quatre vérifications : **Accessibilité**, **Authentification et modèle**, **Appel d’outils** et **Streaming**. Chacune affiche **Réussi**, **Échec** ou **Ignoré**. L’agent utilise des appels d’outils pour rechercher dans les documents, lire et modifier des fichiers et exécuter des programmes ; choisissez donc un modèle qui réussit **Appel d’outils**.

## Clés et stockage sécurisé

Les clés sont stockées chiffrées dans le stockage sécurisé de votre système d’exploitation. Lorsqu’il n’est pas disponible, VERA vous demande de choisir : **Utiliser pour cette exécution seulement** garde la clé en mémoire jusqu’à la fermeture de VERA, **Stocker sans chiffrement sécurisé** l’enregistre dans un fichier lisible par toute personne ayant accès à votre compte. Pour remplacer une clé, saisissez-en une nouvelle ; pour la supprimer, utilisez **Supprimer la clé enregistrée**. **Supprimer** supprime une connexion.

## Choisir un modèle

- Pour une session : choisissez le **Modèle** à côté de la zone de message.
- Pour un banc de travail : **Modifier le banc** → **Agent et conversation** → **Modèle par défaut**, sous la forme `provider/model`. Laissez le champ vide pour utiliser la valeur par défaut de l’application.

Le choix de la session l’emporte sur la valeur par défaut du banc de travail, et celle du banc de travail sur celle de l’application.

## Erreurs courantes

| Message | Que faire |
|---|---|
| **Échec de l’authentification. Vérifiez l’identifiant enregistré dans les paramètres Fournisseurs.** | Saisissez à nouveau la clé ou reconnectez-vous |
| **Limite de débit du fournisseur.** | Attendez le délai affiché, puis réessayez |
| **Le fournisseur a refusé la taille du contexte.** | Raccourcissez l’entrée ou corrigez **Fenêtre de contexte (jetons)** |
| **Impossible de joindre …** | Démarrez le serveur local ou vérifiez le réseau et l’**URL de base** |

Consultez aussi [Dépannage](troubleshooting.md).
