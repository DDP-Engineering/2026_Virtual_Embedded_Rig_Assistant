# Fournisseurs et modèles

Un fournisseur donne à VERA l’accès à un modèle de langage. Il vous en faut au moins un. Configurez les fournisseurs dans **Paramètres** → **Fournisseurs**. Sélectionnez **Ajouter un fournisseur** et choisissez le fournisseur dans la liste **Fournisseur**. La liste comprend l’**Abonnement ChatGPT**.

Sélectionnez un fournisseur connecté à gauche pour afficher ses actions et ses modèles. Utilisez **Modifier**, **Tester** ou **Supprimer** pour les connexions locales et API, et **Se déconnecter** pour l’abonnement ChatGPT. La progression apparaît à côté de **Tester**. Ouvrez **Détails du test** pour voir le résultat de chaque étape.

Cochez les modèles à proposer dans les sélecteurs du chat et du banc de travail. Utilisez **Par défaut** pour définir le modèle de l’application. **Enregistrer** en haut à droite applique les coches et le modèle par défaut. **Annuler** écarte les modifications. Dans une longue liste, utilisez **Filtrer les modèles** et la pagination.

## Abonnement ChatGPT

1. Sélectionnez **Ajouter un fournisseur**, choisissez **Abonnement ChatGPT** comme **Fournisseur**, puis sélectionnez **Se connecter avec ChatGPT**. Le navigateur de votre système ouvre la page de connexion.
2. Connectez-vous sur cette page. VERA affiche **Connecté avec ChatGPT** une fois l’opération terminée.

Le jeton est renouvelé automatiquement. **Se déconnecter** le supprime.

- Si la connexion n’aboutit pas, collez l’adresse finale du navigateur dans **Collez l’URL de redirection finale si la connexion n’aboutit pas** et sélectionnez **Terminer la connexion**.
- La connexion expire au bout de 10 minutes.
- Si le port 1455 est occupé, une connexion dans Codex CLI est souvent encore ouverte. Annulez-la et réessayez.

## API OpenAI

1. Sélectionnez **Ajouter un fournisseur** et choisissez **API OpenAI** comme **Fournisseur**.
2. Saisissez la **Clé API OpenAI** et, si vous le souhaitez, un **Modèle OpenAI**.
3. Sélectionnez **Enregistrer**.

## OpenCode Console et OpenCode Go

1. Dans OpenCode Console, créez une clé API pour l’espace de travail. Donnez-lui les droits de lecture des modèles et d’inférence.
2. Dans VERA, sélectionnez **Ajouter un fournisseur**, puis choisissez **OpenCode Console** pour le paiement à l’usage ou **OpenCode Go** pour l’abonnement Go.
3. Saisissez la clé et lancez la recherche de modèles. Choisissez un modèle dans la liste de l’offre ou saisissez son identifiant exact et ses limites pour une configuration manuelle.
4. Enregistrez et testez la connexion. Choisissez le modèle pour votre session ou votre banc de travail.

VERA stocke séparément la clé de chaque connexion. Vous pouvez réutiliser la même clé si l’espace de travail dispose de crédits et d’un abonnement Go. Les modèles Console gratuits sont réservés à OpenCode. Consultez les limites de l’espace et l’option Go Extra Usage pour savoir quand OpenCode peut débiter le solde.

Le catalogue indique les fonctions des modèles. Testez la connexion pour vérifier l’appel d’outils et les réponses en flux du modèle choisi.

Consultez la [configuration d’OpenCode](https://opencode.ai/docs/console/harnesses) et le [guide de l’offre Go](https://opencode.ai/docs/console/go/).

## QwenCloud Standard et QwenCloud Token Plan

1. Sélectionnez **Ajouter un fournisseur**, puis choisissez **QwenCloud Standard** pour une clé API de Singapour avec paiement à l’usage, ou **QwenCloud Token Plan** pour la clé dédiée à cette offre (`sk-sp-`). VERA renseigne l’URL de base de l’offre sélectionnée.
2. Saisissez la clé correspondante et sélectionnez **Rechercher des modèles**. Si la liste est indisponible, saisissez l’identifiant exact du modèle proposé par votre région ou votre offre. Par exemple, `qwen3.8-flash` accepte le texte et les images, peut appeler des outils et propose un mode de raisonnement désactivable. `qwen3.7-max` propose les appels d’outils et le même mode avec une entrée texte. Les capacités des autres modèles peuvent être non vérifiées.
3. Sélectionnez **Enregistrer**, puis **Tester**. Si l’étape de disponibilité du catalogue est ignorée, l’étape d’authentification et de modèle vérifie la clé et le modèle par une requête de chat. Choisissez le modèle pour votre session ou votre banc de travail.

Utilisez Token Plan pour les sessions d’agent interactives dans le cadre de la [politique d’utilisation](https://docs.qwencloud.com/token-plan/token-plan-permissions-and-usage). Si les crédits sont épuisés, consultez la consommation et le quota de l’offre. Si la limite de fréquence est atteinte, patientez avant de réessayer.

Consultez [les clés API QwenCloud](https://docs.qwencloud.com/developer-guides/administration/api-keys) et [les modèles et erreurs Token Plan](https://docs.qwencloud.com/token-plan/token-plan-faq).

## DeepSeek, Moonshot AI et Kimi For Coding

1. Sélectionnez **Ajouter un fournisseur**, puis choisissez **DeepSeek** pour une clé API DeepSeek, **Moonshot AI** pour une clé de la plateforme internationale Kimi API ou **Kimi For Coding** pour une clé de la console Kimi Code. VERA renseigne l’URL de base du service.
2. Saisissez la clé du service. Pour DeepSeek et Moonshot AI, choisissez **Rechercher des modèles** ou saisissez l’identifiant exact du modèle. Pour Kimi For Coding, saisissez un identifiant comme `kimi-for-coding` ou `k3-256k`, selon votre abonnement.
3. Sélectionnez **Enregistrer**, puis **Tester**. Pour Kimi For Coding, le contrôle d’accessibilité est ignoré. Le contrôle d’authentification et du modèle envoie une requête au modèle.

Saisissez l’identifiant exact du modèle Kimi For Coding. En cas d’erreur de saisie, Kimi Code peut répondre avec un modèle de repli. Un test réussi laisse les capacités des identifiants Kimi inconnus sans confirmation.

DeepSeek Flash, Kimi K3 de Moonshot AI et les deux modèles Kimi Code cités acceptent le texte et les images dans VERA. DeepSeek V4 Pro accepte le texte. Les capacités des autres modèles peuvent être non vérifiées.

Consultez les [limites des modèles DeepSeek](https://api-docs.deepseek.com/api/list-models/), le [guide Moonshot Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) et la [configuration des modèles Kimi Code](https://www.kimi.com/code/docs/en/kimi-code/models).

## MiniMax et Z.AI

1. Sélectionnez **Ajouter un fournisseur**, puis choisissez **MiniMax API** pour une clé de paiement à l’usage (`sk-api-`) ou **MiniMax M Plan** pour une clé d’abonnement MiniMax (`sk-cp-`). Les deux utilisent le service international Messages.
2. Choisissez **Z.AI API** pour une clé API standard. **Z.AI GLM Coding Plan** utilise l’adresse internationale dédiée à l’abonnement. Utilisez une clé Personal Coding Plan ou Team Plan uniquement si Z.AI a autorisé l’accès depuis VERA. Z.AI limite l’abonnement aux outils pris en charge et sa liste publiée ne mentionne pas VERA. Vérifiez le type de clé dans votre compte, car certaines clés fonctionnent à plusieurs adresses et la facturation dépend de la clé et de l’adresse.
3. Choisissez un modèle suggéré ou saisissez l’identifiant exact activé pour votre compte. Sélectionnez **Enregistrer**, puis **Tester**. Le test envoie des requêtes au modèle qui peuvent consommer du quota. Choisissez le modèle enregistré pour votre session ou votre banc de travail.

`MiniMax-M3.1-Flash` et `glm-5.3-flash` acceptent le texte et les images, prennent en charge les appels d’outils et proposent des niveaux de raisonnement. Avec MiniMax API, `MiniMax-M3` accepte le texte et les images et permet d’activer ou de désactiver le raisonnement. `glm-5.3` accepte le texte et prend en charge les appels d’outils et les niveaux de raisonnement. Les capacités des autres identifiants saisis manuellement restent non vérifiées.

Consultez la [configuration des clés MiniMax](https://platform.minimax.io/docs/guides/quickstart-preparation), la [gestion des clés Z.AI](https://docs.z.ai/devpack/notice/api-key-management) et les [outils pris en charge par Z.AI](https://docs.z.ai/devpack/tool/others#supported-tools).

## Alibaba Cloud et Xiaomi MiMo

1. Choisissez **Alibaba Cloud Model Studio** pour une facturation à l’usage. Sélectionnez la région dans la console Model Studio, copiez l’**ID de l’espace de travail** (qui commence par `llm-`) et saisissez une clé de cet espace.
2. Choisissez **Alibaba Cloud Coding Plan** pour une clé internationale Coding Plan (`sk-sp-`). Utilisez la connexion de Singapour. QwenCloud Standard et Token Plan ont leurs propres préréglages et clés de compte.
3. Choisissez **Xiaomi MiMo API** pour une clé d’API d’inférence en temps réel (`sk-`) sur le point d’accès mondial. Pour **Xiaomi MiMo Token Plan**, sélectionnez la région indiquée sur la page Token Plan (Chine, Singapour ou Europe) et utilisez la clé individuelle (`tp-`) ou d’équipe (`ttp-`).
4. Sélectionnez **Rechercher des modèles** si l’option est disponible, ou saisissez l’ID exact du modèle de chat indiqué dans la console du fournisseur. Sélectionnez **Enregistrer**, puis **Tester**. Le test utilise la connexion choisie et peut consommer du quota. Choisissez un modèle pour la session ou le banc de travail.

Essayez `qwen3.7-flash` dans Model Studio, `qwen3.7-plus` dans Coding Plan ou `mimo-v2.6-flash` dans MiMo selon les droits de votre compte. La présence au catalogue ne confirme pas l’accès. Les capacités des autres ID saisis manuellement peuvent rester non vérifiées. Ajoutez une connexion pour une autre région ou un autre espace de travail.

Voir [Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq), [MiMo API](https://mimo.mi.com/docs/en-US/api/chat/openai-api-post), [MiMo Token Plan](https://mimo.mi.com/docs/tokenplan/subscription).

Utilisez Alibaba Coding Plan dans les outils de programmation interactifs pris en charge par Alibaba. Utilisez MiMo Token Plan pour la programmation, conformément aux règles d’utilisation de Xiaomi.

## Fireworks AI, Together AI, Groq et Cerebras

1. Sélectionnez **Ajouter un fournisseur**, puis choisissez le service et saisissez une clé API issue de sa console. VERA renseigne l’adresse du service et stocke séparément la clé de chaque connexion.
2. Sélectionnez **Rechercher des modèles** ou saisissez l’identifiant complet du modèle et ses limites. Conservez le préfixe du compte pour Fireworks, par exemple `accounts/fireworks/models/glm-5p3-flash`. Pour un point d’accès dédié, copiez son identifiant d’inférence exact depuis le service.
3. Enregistrez, puis sélectionnez **Tester** pour vérifier la clé et le modèle choisi. La prise en charge des outils et des images s’affiche lorsqu’elle figure dans le catalogue ou la documentation du modèle. Vérifiez les limites et l’accès aux modèles de votre compte.

Consultez les listes de modèles de [Fireworks AI](https://fireworks.ai/models), [Together AI](https://docs.together.ai/docs/serverless/models), [Groq](https://console.groq.com/docs/models) et [Cerebras](https://inference-docs.cerebras.ai/models/overview).

## Hugging Face Inference Providers, NVIDIA NIM et Vercel AI Gateway

1. Sélectionnez **Ajouter un fournisseur**, puis choisissez le service et saisissez sa clé. Hugging Face demande un jeton d’accès avec l’autorisation Inference Providers. NVIDIA NIM demande une clé donnant accès à NVIDIA Public API Endpoints. Vercel demande une clé AI Gateway.
2. Sélectionnez **Rechercher des modèles** et choisissez un modèle, ou saisissez l’identifiant complet et les limites d’un modèle à accès restreint ou propre à votre compte. Conservez le préfixe et les barres obliques. Pour Hugging Face, conservez un suffixe tel que `owner/model:novita` si vous choisissez explicitement un fournisseur en amont.
3. Enregistrez la connexion et sélectionnez **Tester** pour vérifier le modèle choisi avec votre clé. La présence dans le catalogue ne garantit pas l’accès. En cas de refus, vérifiez l’identifiant exact, vos autorisations ou votre forfait dans le service avant de modifier la connexion.

VERA envoie les requêtes au service indiqué dans le sélecteur de modèles. [Hugging Face](https://huggingface.co/docs/inference-providers/index) et [Vercel](https://vercel.com/docs/ai-gateway/models-and-providers) transmettent les requêtes à leurs fournisseurs. [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) exécute le modèle hébergé sélectionné. Le sélecteur affiche les types d’entrée et la prise en charge des outils lorsqu’ils sont documentés.

## LM Studio

1. Démarrez le serveur LM Studio et chargez un modèle.
2. **Ajouter un fournisseur**, **Fournisseur** LM Studio. L’adresse `http://localhost:1234` est préremplie.
3. Sélectionnez **Tester la connexion**. VERA lit les modèles de conversation du serveur ; les modèles d’embedding sont ignorés.
4. Choisissez le modèle de la connexion et sélectionnez **Enregistrer**.
5. Dans la liste des modèles du fournisseur, ouvrez les **Paramètres du modèle**. Réglez la fenêtre de contexte, la limite de sortie, le raisonnement, la température et la prise en charge des images. Un paramètre facultatif vide utilise la valeur par défaut du fournisseur.

Pour LM Studio, une clé API est facultative.

## Ollama et autres points de terminaison compatibles

1. **Ajouter un fournisseur**, **Fournisseur** Ollama ou **Autre fournisseur compatible**. Pour Ollama, l’**URL de base** `http://localhost:11434/v1` est préremplie.
2. Renseignez **Nom du point de terminaison**, **URL de base** (une adresse `http` ou `https` se terminant par `/v1`), **Modèle** (le nom du modèle tel que le serveur le connaît), **Fenêtre de contexte (jetons)** et **Sortie maximale (jetons)**.
3. Saisissez une **Clé API du point de terminaison** si le serveur en exige une, ou laissez le champ vide.
4. Sélectionnez **Enregistrer**.

Reprenez la fenêtre de contexte de la documentation du modèle ou des paramètres de votre serveur. Une valeur trop grande provoque des erreurs du serveur ; une valeur trop petite amène VERA à résumer l’historique plus tôt que nécessaire.

## Modèles locaux lents

Un modèle local peut mettre plusieurs minutes à se charger ou à lire une longue invite. **Délai de réponse (s)** fixe combien de temps VERA attend la première réponse, puis entre les parties de la réponse, de 10 à 3600 secondes ; la valeur initiale est 300. Le raisonnement que le serveur diffuse compte comme une réponse : un modèle qui réfléchit encore n’est pas arrêté.

## Prise en charge des images

Le champ de message affiche un avertissement lorsque le modèle actuel reçoit uniquement les chemins des images.

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

La liste affiche le fournisseur, la limite de contexte, les types d’entrée et les informations connues sur les outils et le raisonnement. **Outils non vérifiés** indique que les appels d’outils n’ont pas été confirmés pour ce modèle.

## Erreurs courantes

| Message | Que faire |
|---|---|
| **Échec de l’authentification. Vérifiez l’identifiant enregistré dans les paramètres Fournisseurs.** | Saisissez à nouveau la clé ou reconnectez-vous |
| **Limite de débit du fournisseur.** | Attendez le délai affiché, puis réessayez |
| **Le fournisseur a refusé la taille du contexte.** | Raccourcissez l’entrée ou corrigez **Fenêtre de contexte (jetons)** |
| **Impossible de joindre …** | Démarrez le serveur local ou vérifiez le réseau et l’**URL de base** |
| **Le modèle n’a pas répondu dans un délai de … s.** | Augmentez **Délai de réponse (s)** pour la connexion ou vérifiez que le serveur fonctionne |

Consultez aussi [Dépannage](troubleshooting.md).
