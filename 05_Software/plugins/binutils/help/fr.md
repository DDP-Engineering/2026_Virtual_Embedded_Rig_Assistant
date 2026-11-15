# GNU binutils (ARM, RISC-V)

GNU binutils permet à l’agent d’examiner des fichiers ELF de firmware ARM et RISC-V locaux avec `size`, `nm`, `readelf`, `objdump` et `addr2line` des chaînes d’outils `arm-none-eabi-` et `riscv-none-elf-`. Il compare les tailles des sections et des symboles entre deux builds, explique l’organisation mémoire, désassemble une fonction ou une petite plage d’adresses, et traduit les adresses d’un crash en fonctions et en lignes de source. Il lit uniquement des fichiers sur cet ordinateur et ne touche jamais à une carte.

## Prérequis

- Les dix programmes binutils (cinq par architecture). VERA cherche d’abord une chaîne d’outils que vous avez déjà : PATH, STM32CubeCLT et STM32CubeIDE (ARM), PlatformIO, Arduino, le Zephyr SDK et les dossiers xPack. Une chaîne d’outils installée ailleurs peut être ajoutée au PATH.
- Si aucune n’est trouvée, **Installer les dépendances** sur la page du plugin télécharge la chaîne d’outils xPack épinglée (ARM 15.2.1-1.1, RISC-V 15.2.0-1) dans le dossier des programmes de VERA et vérifie son SHA-256. Rien n’est installé globalement.
- Le fichier ELF du build exact que vous examinez. Un build ultérieur peut donner des lignes de source plausibles mais fausses.
- Aucun plugin, matériel ni configuration requis. Les fichiers ELF et les chaînes d’outils Espressif relèvent du plugin esp32-idf.

## Utilisation

- « Comparez build/v1.2/app.elf avec build/v1.3/app.elf et dites-moi quels symboles ont le plus grossi. » (compétence `firmware-size`)
- « D’où viennent les 2 Ko de RAM supplémentaires du nouveau build ? »
- « Décodez ce HardFault : PC 0x08001a3c, LR 0x08001a11, avec build/app.elf. » (compétence `crash-decode`)
- « Montrez les sections et les segments de chargement de firmware.elf et comparez-les au script de l’éditeur de liens. » (compétence `elf-inspect`)
- « Désassemblez la fonction `uart_rx_handler` avec son code source. »

L’agent désassemble uniquement la fonction ou la plage d’adresses étudiée, jamais l’image entière. Il signale `??` ou `:0` comme non résolus au lieu de deviner une ligne.

## Risques et approbations

Toutes les commandes de ce plugin sont classées Sûr : les programmes analysent des fichiers de l’hôte et n’accèdent jamais au matériel, ils s’exécutent donc sans demander dans tous les modes d’autorisation, y compris Lecture seule. Il n’y a aucune commande d’écriture appareil ni irréversible.

## Limites

- Windows x64, Linux x64 et Linux arm64. Les archives Linux arm64 sont vérifiées, mais leur exécution n’est pas encore prouvée sur un hôte arm64.
- Un binaire existant dont la version ne peut pas être lue reste indisponible ; VERA n’en télécharge pas un autre en silence.
- La sortie de commande renvoyée à l’agent est limitée aux 12 000 derniers caractères ; la sortie complète reste dans le journal d’exécution.
- Référence : https://sourceware.org/binutils/docs/binutils/
