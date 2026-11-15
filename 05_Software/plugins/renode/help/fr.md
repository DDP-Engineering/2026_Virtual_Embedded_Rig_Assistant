# Cartes virtuelles Renode

Ce plugin permet à l’agent d’exécuter un ELF de firmware sur une carte virtuelle prise en charge avec Renode 1.17.0 épinglé, avant le matériel ou sans lui. L’agent liste les profils de cartes pris en charge, vérifie un firmware par rapport à l’architecture, à la carte mémoire et à l’adresse de démarrage d’un profil avant toute exécution, le démarre sans interface, capture son UART et exécute des jeux de tests approuvés (lignes UART, ticks de timer, stimuli de bouton et d’UART, la LED modélisée) avec des budgets de temps virtuel et réel distincts. Les résultats vont dans `embedded-lab-results/` et comptent toujours comme des preuves virtuelles, pas comme un test matériel.

## Prérequis

- **Renode 1.17.0.** **Installer les dépendances** télécharge le paquet portable épinglé dans le dossier des programmes de VERA et vérifie son SHA-256 ; un Renode 1.17.0 dans le PATH convient aussi. Une autre version du moteur bloque l’exécution.
- **renode-sim**, un script Python du plugin, que VERA installe lui-même. L’agent passe toujours par lui.
- Un ELF de firmware compilé pour une carte prise en charge. Le premier profil est `stm32f4-discovery` (STM32F407, Cortex-M4F) avec le jeu de tests approuvé `board-basics`.
- Aucun matériel, aucun autre plugin et aucune configuration. Vous pouvez ajouter vos propres profils dans `renode/profiles/<id>/` et vos jeux de tests dans `renode/tests/<id>/` du banc de travail ; ils sont vérifiés comme ceux du plugin.

## Utilisation

L’agent utilise la compétence `virtual-boards`. Il indique explicitement l’architecture et l’adresse de démarrage et ne passe jamais à un autre profil simplement pour faire réussir une vérification.

- « Quelles cartes virtuelles sont prises en charge ? »
- « Vérifiez build/app.elf par rapport à stm32f4-discovery en cortex-m4 avec l’adresse de démarrage 0x08000000. »
- « Démarrez le firmware sur la carte virtuelle pendant 2 secondes virtuelles et montrez la sortie UART. »
- « Exécutez le jeu de tests board-basics avec la version 1.2.3. »
- « Rédigez un rapport de l’exécution virtuelle à côté de l’exécution HIL. »

## Risques et approbations

Toutes les opérations de renode-sim (tools, profiles, validate, run, capture-uart, test, report) sont classées **Sûr** : elles s’exécutent uniquement sur votre ordinateur, n’utilisent aucun appareil, aucun port réseau en écoute ni aucun fichier de l’hôte hors du nouveau dossier d’exécution, et s’exécutent sans demander. L’exécution directe de Renode est classée **Bloqué**, car son moniteur peut exécuter du Python, inclure des scripts, télécharger des fichiers et ouvrir des sockets ou des périphériques de l’hôte.

## Limites

- Windows x64 et Linux x64 ; Ubuntu natif n’a pas encore été vérifié.
- Seuls les profils approuvés s’exécutent ; il n’y a pas d’accès à la console Renode, aux commandes du moniteur, aux scripts `.resc` ni à Robot Framework.
- Si le firmware utilise un périphérique que le modèle n’implémente pas, le résultat est incomplet. Le modèle STM32F4 ne simule pas l’arbre d’horloge, la temporisation au cycle près, le DAC, l’ADC, l’USB, le SDIO, le DCMI ni les composants externes de la carte.
- Le temps virtuel est un temps simulé. Une simulation ne dit rien de la temporisation électrique, de la consommation, des perturbations électromagnétiques (EMI) ni du circuit analogique.
- Un fichier `.repl` du banc de travail doit être examiné comme du code.
