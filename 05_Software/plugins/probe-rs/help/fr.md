# probe-rs

Ce plugin permet à l’agent de travailler avec une sonde de débogage connectée à votre ordinateur au moyen de probe-rs 0.32.0. Il identifie les sondes et les cibles, flashe et vérifie l’ELF exact du build, réinitialise la cible, lit la mémoire et les registres de périphériques, et diffuse les journaux RTT en arrière-plan sur des cibles ARM, RISC-V et Xtensa prises en charge (par exemple `esp32`, `esp32s3`, `esp32c3`).

## Prérequis

- **probe-rs 0.32.0.** VERA cherche d’abord dans le PATH et dans `~/.cargo/bin` ; s’il ne trouve rien, **Installer les dépendances** télécharge la version portable épinglée dans le dossier des programmes de VERA. Une copie trouvée dans une autre version est signalée comme indisponible : corrigez d’abord le PATH ou cette installation.
- **Une sonde de débogage et une carte cible**, avec les pilotes et l’accès aux périphériques que vous configurez vous-même. Sous Linux, il s’agit de la règle udev de probe-rs et de l’appartenance au groupe `plugdev`. Sous Windows, le ST-Link utilise le pilote STSW-LINK009 de ST, J-Link et FTDI nécessitent WinUSB, et CMSIS-DAP ne nécessite normalement rien de plus. VERA n’installe jamais de pilotes ni de règles. Guide d’installation : https://probe.rs/docs/getting-started/probe-setup/
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt` et `probe-rs-inspect`. Il nomme toujours la sonde et la puce qu’il a observées et ne les devine jamais d’après un exemple.

- « Listez les sondes de débogage connectées et identifiez la cible sur le ST-Link. »
- « Flashez build/app.elf sur le STM32, vérifiez-le et réinitialisez la cible. »
- « Attachez-vous à la cible et suivez le journal RTT jusqu’à ce qu’il affiche “ready”, puis arrêtez. »
- « Lisez le registre RCC_CR du STM32F4 et décodez ses champs. »
- « Le firmware a déclenché un HardFault : faites correspondre le PC et le LR empilés aux lignes de source. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : aide, version, liste des cibles et liste des sondes ; ces commandes ne se connectent pas à une cible.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : info, read, verify, attach, profile et trace peuvent arrêter brièvement la cible ; reset la redémarre sans modifier le firmware.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : download, run, erase et benchmark écrasent la flash ou la RAM ; itm configure le matériel de trace. L’approbation est liée au hash de l’ELF.
- **Irréversible** (demande, et vous tapez le mot de confirmation `write`) : écriture arbitraire en mémoire, car une écriture dans un contrôleur de flash ou un registre d’options peut activer une protection en lecture permanente, et une écriture dans un registre GPIO pilote des broches. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.
- **Bloqué** : le débogage interactif, les serveurs GDB et DAP, la complétion shell et les sondes distantes (`--host`).

## Limites

- Windows x64, Linux x64 et Linux ARM64.
- L’entrée RTT n’est pas prise en charge ; un firmware avec des canaux RTT descendants n’a pas encore été vérifié sur un banc.
- Le plugin n’a pas encore été vérifié avec une vraie sonde et une vraie carte.
