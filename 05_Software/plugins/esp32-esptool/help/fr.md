# ESP32 esptool

ESP32 esptool permet à l’agent d’identifier, de flasher, de vérifier, d’effacer et de lire des puces Espressif sur un port série avec esptool v5. Il lit les images et les offsets d’un build ESP-IDF, les écrit sur la puce, vérifie que chaque image a été validée et capture le journal de démarrage qui suit.

## Prérequis

- **esptool** 5 depuis PyPI, installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Le plugin **serial-monitor**, qui trouve le port de la carte et capture son journal de démarrage. **Installer avec les dépendances** l’ajoute.
- Une carte de la famille ESP32 sur un port série. Sous Linux, votre utilisateur doit appartenir au groupe propriétaire des ports série : `dialout` (Debian, Ubuntu, Fedora) ou `uucp` (Arch).
- Aucun paramètre de configuration.

## Utilisation

- « Quelle puce se trouve sur COM5 ? » (compétence `esp32-flash`)
- « Flashez le build ESP-IDF de build/ sur l’ESP32-S3 du COM5, vérifiez-le et affichez le journal de démarrage. »
- « Vérifiez que la carte du COM5 contient toujours ce build. »
- « Sauvegardez toute la flash de l’ESP32 du COM5 dans backup.bin. »
- « Effacez la flash de la carte du COM5. »

L’agent trouve le port avec le moniteur série et ne le devine jamais. Il confirme d’abord le type de puce puis le transmet à chaque commande, de sorte qu’une mauvaise carte provoque un échec au lieu d’être écrite. Il utilise exactement les offsets de `build/flasher_args.json`. Si le build active le secure boot ou le chiffrement de la flash, il s’arrête et vous demande avant de flasher, car un tel bootloader programme des eFuses à son premier démarrage. Avant d’effacer, il vous prévient que les données NVS et les identifiants Wi-Fi sont également supprimés.

## Risques et approbations

- Sûr, exécuté sans demander : les commandes qui ne travaillent que sur des fichiers (`merge-bin`, `image-info`, `elf2image`).
- Lecture appareil : identification de la puce, lecture de la MAC, de l’ID de flash et de l’état de sécurité, vérification et lecture de la flash. Chaque commande qui se connecte réinitialise la puce dans son bootloader et arrête le firmware en cours d’exécution.
- Écriture appareil : `write-flash`, `erase-flash`, `erase-region` et `load-ram`. La carte d’approbation liste chaque image avec son SHA-256 ; si une image est recompilée après votre approbation, l’exécution échoue et l’approbation est redemandée.
- Irréversible : `write-mem`, `write-flash-status` et toute commande avec `--force`. Elles peuvent fixer définitivement des bits d’eFuse ou de verrouillage de la flash, ou rendre une puce sécurisée impossible à démarrer. L’agent ne les utilise que si vous demandez exactement cette commande, et VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.

En mode Demander, VERA demande avant chaque commande de lecture appareil et d’écriture appareil ; le mode Modification auto exécute les commandes de lecture appareil sans demander.

## Limites

- Windows x64 et Linux x64.
- Quand la puce n’entre pas dans son bootloader, il peut être nécessaire de maintenir BOOT, d’appuyer sur RESET puis de relâcher BOOT.
- Référence : https://docs.espressif.com/projects/esptool/en/latest/
