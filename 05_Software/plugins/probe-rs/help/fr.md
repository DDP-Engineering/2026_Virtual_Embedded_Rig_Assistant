# probe-rs

Ce plugin permet à l’agent de travailler avec une sonde de débogage connectée à votre ordinateur au moyen de probe-rs 0.32.0. Il identifie les sondes et les cibles, flashe, vérifie et redémarre l’ELF exact du build en une seule exécution, sauvegarde le firmware présent sur la carte, lit la mémoire et les registres de périphériques, suit les journaux RTT en arrière-plan, intercepte un HardFault ou une réinitialisation inattendue avec sa pile d’appels, exécute des tests sur la cible et profile le firmware en cours d’exécution, sur des cibles ARM, RISC-V et Xtensa prises en charge (par exemple `esp32`, `esp32s3`, `esp32c3`).

## Prérequis

- **probe-rs 0.32.0.** VERA cherche d’abord dans le PATH et dans `~/.cargo/bin` ; s’il ne trouve rien, **Installer les dépendances** télécharge la version portable épinglée dans le dossier des programmes de VERA. Une copie trouvée dans une autre version est signalée comme indisponible : corrigez d’abord le PATH ou cette installation.
- **Une sonde de débogage et une carte cible**, avec les pilotes et l’accès aux périphériques que vous configurez vous-même. Sous Linux, il s’agit de la règle udev de probe-rs et de l’appartenance au groupe `plugdev`. Sous Windows, le ST-Link utilise le pilote STSW-LINK009 de ST, J-Link et FTDI nécessitent WinUSB, et CMSIS-DAP ne nécessite normalement rien de plus. VERA n’installe jamais de pilotes ni de règles. Guide d’installation : https://probe.rs/docs/getting-started/probe-setup/
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt`, `probe-rs-inspect`, `probe-rs-test` et `probe-rs-profile`. Il nomme toujours la sonde et la puce qu’il a observées et ne les devine jamais d’après un exemple.

- « Listez les sondes de débogage connectées et identifiez la cible sur le ST-Link. »
- « Flashez build/app.elf sur le STM32, vérifiez-le et réinitialisez la cible. »
- « Sauvegardez le firmware présent sur la carte, puis flashez build/app.elf. »
- « Attachez-vous à la cible et suivez le journal RTT jusqu’à ce qu’il affiche “ready”, puis arrêtez. »
- « Lisez le registre RCC_CR du STM32F4 et décodez ses champs. »
- « La carte plante après quelques minutes : surveillez-la et montrez-moi où dans le code. »
- « Exécutez sur la cible les tests de build/tests.elf et dites-moi lesquels ont échoué. »
- « Profilez le firmware pendant 10 secondes et listez les fonctions qui prennent le plus de temps. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : aide, version, liste des cibles, description d’une puce et liste des sondes ; ces commandes ne se connectent pas à une cible.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : info, read, verify, attach, profile et trace peuvent arrêter brièvement la cible ; reset la redémarre sans modifier le firmware.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : download, run, erase et benchmark écrasent la flash ou la RAM ; un profil avec `--flash` écrit d’abord le firmware ; itm configure le matériel de trace. `write` modifie des mots mémoire : une écriture dans un contrôleur de flash ou un registre d’options peut verrouiller la puce, et une écriture dans un registre GPIO pilote des broches. L’approbation est liée au hash de l’ELF.
- **Bloqué** : le débogage interactif, les serveurs GDB et DAP, la complétion shell et les sondes distantes (`--host`).

## Limites

- Windows x64, Linux x64 et Linux ARM64.
- Le flashage, la vérification, l’effacement, la lecture de la mémoire et le profilage peuvent durer 30 minutes, les tests et les journaux une heure, toute autre commande 2 minutes.
- Une capture de journal arrête la cible sur un HardFault et sur une réinitialisation, pour montrer où cela s’est produit ; l’agent peut désactiver ce comportement pour suivre le journal au-delà des réinitialisations.
- L’entrée RTT n’est pas prise en charge ; un firmware avec des canaux RTT descendants n’a pas encore été vérifié sur un banc.
- Le plugin n’a pas encore été vérifié avec une vraie sonde et une vraie carte.
