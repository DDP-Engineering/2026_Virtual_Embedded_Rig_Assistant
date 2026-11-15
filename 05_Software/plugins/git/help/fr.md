# Git

Git permet à l’agent d’examiner et de modifier le dépôt Git du banc de travail. Il lit librement l’état, l’historique, les diffs, le blame et les listes de branches, d’étiquettes, de dépôts distants et de remises (stash) ; l’indexation, les commits, le travail sur les branches et le contact avec les dépôts distants attendent votre approbation. Les éditeurs interactifs, les pagers et les hooks sont désactivés, de sorte que chaque commande s’exécute sans invite.

## Prérequis

- **Git 2.40 ou plus récent**, que vous installez vous-même (Git for Windows, ou le paquet git de votre distribution). VERA le trouve dans le PATH, dans les dossiers standard de Git for Windows ou à `/usr/bin/git`, et ne le télécharge jamais. Utilisez **Vérifier les dépendances** sur la page du plugin après l’installation.
- Pour fetch, pull, push et clone : vos propres identifiants configurés ou vos clés SSH. VERA n’ajoute pas d’identifiants, et Git ne les demande pas.
- Aucun plugin, matériel ni paramètre de configuration requis.

## Utilisation

- « Qu’est-ce qui a changé depuis la dernière étiquette de version ? » (compétence `git-inspect`)
- « Qui a modifié en dernier les lignes 40 à 60 de src/main.c ? »
- « Committez les modifications de src/uart.c et src/uart.h avec le message “Corrige la gestion des débordements UART”. » (compétence `git-commit`)
- « Créez une branche feature/adc-calibration à partir de main et basculez dessus. » (compétence `git-branches`)
- « Fusionnez feature/adc-calibration dans main. »

L’agent n’indexe que les chemins convenus avec vous, écrit le message avec `commit -m` et cite le hash du commit obtenu. Il ne pousse rien sans votre demande, ne réécrit jamais un historique déjà poussé et vous signale les conflits de fusion ou de rebase au lieu d’abandonner des modifications.

## Risques et approbations

Les niveaux de risque sont réutilisés pour l’état du dépôt :

- Sûr, exécuté sans demander : status, log, diff, show, blame, describe, grep et les autres commandes de lecture, ainsi que la liste des branches, des étiquettes, des dépôts distants et des remises.
- Écriture appareil : les commandes qui modifient l’état enregistré ou contactent un dépôt distant, comme add, commit, switch, merge, rebase, reset, fetch, pull, clone et push, et toute commande qui écrit sa sortie dans un fichier. Les modes Demander et Modification auto demandent avant chacune.
- Irréversible : les commandes qui peuvent perdre du travail ou réécrire l’historique, comme checkout, restore, clean, un reset hard, la suppression d’une remise, et les push forcés ou de suppression. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.
- Bloqué dans tous les modes : les surcharges de configuration, les alias exécutables et les noms de commandes inconnus, les commandes interactives et l’exécution explicite de programmes.

## Limites

- Windows x64, Linux x64 et Linux arm64.
- Git n’est pas isolé : des filtres de contenu comme LFS et des pilotes textconv ou filter propres au dépôt peuvent encore exécuter des programmes. Traitez un dépôt non fiable avec prudence.
- Les modifications Git n’apparaissent pas dans le panneau Modifications de VERA ; le journal d’exécution enregistre chaque commande et sa sortie.
