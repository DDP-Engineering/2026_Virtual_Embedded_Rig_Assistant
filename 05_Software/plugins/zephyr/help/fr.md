# Compilations, tests et flashage Zephyr

Ce plugin permet à l’agent de compiler des applications Zephyr RTOS pour une carte exacte, de compiler des scénarios de test Twister et de flasher une carte au moyen d’opérations contrôlées. L’agent écrit une requête explicite : l’espace de travail west avec chaque projet à sa révision épinglée, le dossier du SDK, l’application, la carte, les fichiers de configuration et son propre dossier de build. Les builds conservent les fichiers de firmware avec leurs hashs, la configuration, le devicetree et le fichier map. Les projets non listés, les commandes d’extension et les hooks de build sont refusés, sauf si vous les approuvez par leur hash. Les résultats vont dans `embedded-lab-results/`.

## Prérequis

- **Deux utilitaires Python** avec west 1.5.0, CMake 4.4.4 et Ninja 1.13.2 épinglés, que VERA installe lui-même avec **Installer les dépendances**.
- **Un Zephyr SDK 1.0.1 ou plus récent**, que vous installez vous-même, avec la chaîne d’outils GNU de votre carte dans son dossier `gnu/`.
- **Un espace de travail west** avec Zephyr 4.4 ou 4.5, mis en place par vous ou par l’agent lors d’une étape réseau approuvée séparément. Gardez des chemins courts sous Windows.
- Pour le flashage : **STM32CubeProgrammer**, que vous installez vous-même depuis https://www.st.com/en/development-tools/stm32cubeprog.html (un compte ST est requis), une sonde ST-LINK, et le registre du banc `lab/resources.json`, qui déclare la sonde par alias (facultatif ; inutile pour les compilations et les tests). La section **Configuration** de la page du plugin indique s’il est présent et valide.

## Utilisation

L’agent utilise la compétence `zephyr-builds`. Il ne modifie jamais les fichiers `.conf`, overlay ou Kconfig pour faire passer une compilation.

- « Examinez l’espace de travail D:/zw pour apps/blinky sur stm32f4_disco. »
- « Compilez blinky et indiquez l’occupation mémoire. »
- « Compilez le scénario Twister foo.basic et exécutez-le sur la carte STM32F4 Discovery de Renode. »
- « Flashez le dernier build via la sonde stlink1 ; le firmware ne pilote aucun actionneur. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : examen, rapport des artefacts, évaluation des exécutions de tests et liste des différences ; ni compilation, ni code du projet, ni réseau.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : compilation et compilation de tests, car le code de l’espace de travail et de l’application s’exécute sur votre ordinateur (une approbation n’est pas un bac à sable) ; nettoyage du dossier de build ; préparation de l’espace de travail, la seule étape réseau ; et flashage, qui écrase la flash de la cible.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : flashage d’un firmware qui pilote des actionneurs dès son démarrage. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.
- **Bloqué** : l’appel direct de STM32_Programmer_CLI ; utilisez l’opération de flashage ou le plugin stm32-cubeprog.

## Limites

- Windows x64 et Linux x64. Vérifié avec Zephyr 4.4.2, le SDK 1.0.1 et `stm32f4_disco` sous Windows x64 ; Ubuntu natif et une vraie carte ne sont pas encore vérifiés.
- Le flashage ne prend en charge que le runner `stm32cubeprogrammer`. Le débogage en direct relève du plugin gdb-debug.
- Twister s’exécute en compilation seule ; un résultat en compilation seule n’est jamais une réussite.
