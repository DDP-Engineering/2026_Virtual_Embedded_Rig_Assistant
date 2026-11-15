# Simulation cloud Wokwi

Ce plugin permet à l’agent d’exécuter des simulations de firmware et des scénarios de test finis dans le cloud de Wokwi avec wokwi-cli 0.29.1 épinglé. L’agent examine un projet, valide son diagramme hors ligne, prépare une tâche composée de copies exactes avec la liste des envois, le compte, les limites et le budget de temps, l’exécute une seule fois dans le cloud après votre approbation, puis récupère le résultat avec la sortie série, le VCD et les captures d’écran. Les résultats vont dans `arduino-iot-results/`. Une simulation dans le cloud n’est ni un test électrique ni un test sur la vraie carte.

## Prérequis

- **wokwi-cli 0.29.1**, que **Installer les dépendances** télécharge depuis sa version GitHub (https://github.com/wokwi/wokwi-cli/releases/tag/v0.29.1) et vérifie par SHA-256, et **wokwi-tool**, un script Python du plugin que VERA installe lui-même.
- **Un jeton Wokwi CI** (`wokwi-token`) obtenu sur votre tableau de bord Wokwi, enregistré sous une référence comme `ci`. Définissez-le dans la section **Configuration** de la page du plugin. Le jeton reste dans le magasin d’identifiants de VERA et n’est transmis qu’à une exécution approuvée de ce plugin ; l’agent ne le voit jamais.
- Un projet Wokwi avec un firmware compilé (`.hex`, `.bin`, `.uf2`, `.elf` ou `flasher_args.json` d’ESP-IDF) et un diagramme comportant exactement une carte. Le plugin ne compile jamais.
- Aucun matériel et aucun autre plugin ne sont requis.

## Utilisation

L’agent utilise les compétences `wokwi-simulation` et `wokwi-scenarios`. Avant l’exécution dans le cloud, il vous montre les fichiers qui seront envoyés, le compte, la carte et les limites de temps, et attend votre accord.

- « Examinez le projet Wokwi de sim/blink et validez son diagramme. »
- « Écrivez un scénario qui appuie sur btn1 et s’attend à ce que led1 s’allume. »
- « Préparez une tâche pour sim/blink avec le compte ci et un délai virtuel de 5 secondes, exécutez-la, puis rédigez un rapport. »
- « Simulez le firmware jusqu’à ce qu’il affiche ready ; échec s’il affiche panic. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : examen du projet, validation du diagramme, préparation d’une tâche, récupération des résultats et rapports. Ces opérations sont hors ligne ; rien n’est envoyé et le projet n’est jamais modifié.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : exécution d’une tâche, car elle envoie le diagramme, le firmware et l’ELF aux serveurs de Wokwi, sans possibilité de les récupérer, et l’exécution est décomptée de votre forfait Wokwi. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.
- **Bloqué** : l’exécution directe de wokwi-cli, car il téléverserait tout le contenu de son dossier de projet et propose un serveur MCP.

## Limites

- Windows x64 et Linux x64.
- Les puces personnalisées, les cartes SD, GDB et les serveurs RFC 2217 sont refusés.
- VERA ne peut pas lire votre quota Wokwi. Après Arrêter, la fin de la tâche côté Wokwi n’est pas confirmée.
- Aucune exécution réelle dans le cloud n’a encore été faite avec ce plugin.
