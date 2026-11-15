# Projets PlatformIO

Ce plugin permet à l’agent d’examiner, de compiler, de tester et de téléverser des projets PlatformIO existants au moyen d’opérations contrôlées. L’agent écrit une requête explicite qui nomme le dossier du projet, l’environnement, un dossier core PlatformIO et son propre dossier de build. Les extra scripts, les scripts de bibliothèque et les exécuteurs de test personnalisés sont refusés, sauf si vous les approuvez par leur hash, et les builds conservent les fichiers de firmware avec leurs hashs, leurs versions et leurs journaux. L’agent n’exécute jamais `pio` directement.

## Prérequis

- **Deux utilitaires Python** avec un PlatformIO Core 6.2.0 épinglé, que VERA installe lui-même avec **Installer les dépendances**. Votre propre `pio` n’est pas utilisé.
- **Un dossier core PlatformIO** : n’importe quel dossier vide de votre choix. Une étape réseau approuvée séparément le remplit de paquets ; les compilations et les tests s’exécutent ensuite hors ligne.
- **Un compilateur hôte** pour les environnements `native`, que vous installez vous-même : GCC sous Linux, un GCC MinGW-w64 sous Windows.
- Pour les téléversements : une sonde ST-Link et le registre du banc `lab/resources.json` dans le banc de travail, qui déclare la sonde par alias (facultatif ; inutile pour les compilations et les tests natifs). La section **Configuration** de la page du plugin indique s’il est présent et valide.
- Aucun autre plugin n’est requis.

## Utilisation

L’agent utilise la compétence `platformio-projects`. Il vous demande quel environnement utiliser et ne modifie jamais platformio.ini ni votre code pour faire passer une compilation.

- « Examinez firmware/board demo et montrez les options effectives de l’environnement disco. »
- « Préparez les paquets de l’environnement disco dans D:/pio-core. »
- « Compilez l’environnement disco et indiquez l’occupation mémoire. »
- « Exécutez les tests Unity natifs test_lines sur cet ordinateur. »
- « Téléversez le dernier build sur la carte via la sonde stlink1 ; le firmware ne pilote aucun actionneur. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : examen du projet et des environnements, rapport des artefacts et évaluation des exécutions de tests. Ces opérations ne lancent ni compilation, ni code du projet, ni accès réseau.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : compilation et tests, car le code du projet s’exécute sur votre ordinateur (une approbation n’est pas un bac à sable) ; nettoyage des dossiers de build de VERA ; préparation des paquets, la seule étape réseau ; et téléversement, qui écrase la flash de la cible.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : un téléversement de firmware qui pilote des actionneurs dès son démarrage. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

Pendant un téléversement, VERA réserve la sonde.

## Limites

- Windows x64 et Linux x64. Vérifié sous Windows x64 avec la plateforme ststm32 (disco_f407vg) et la plateforme native ; les téléversements sur une vraie carte et Ubuntu natif ne sont pas encore vérifiés.
- Les téléversements ne prennent en charge que le protocole `stlink`.
- Les tests sur appareil sont seulement compilés ici ; leur verdict nécessite une exécution Renode ou HIL du même ELF.
