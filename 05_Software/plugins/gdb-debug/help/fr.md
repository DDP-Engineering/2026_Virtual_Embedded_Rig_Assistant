# Débogage GDB

Débogage GDB permet à l’agent de déboguer un firmware Cortex-M avec ses symboles, sans console de débogueur. Hors ligne, il examine un fichier ELF de firmware. Au moyen d’une sonde déclarée, il exécute une session finie et supervisée par appel : un instantané des registres, de la backtrace, des variables locales, des variables en RAM et de l’état de faute décodé, un point d’arrêt matériel avec délai d’expiration, ou un pas à pas limité. Les symboles ne sont affichés que si l’ELF correspond à la flash de la cible. Les résultats vont dans `embedded-lab-results/<run-id>/` du banc de travail.

## Prérequis

- **arm-none-eabi-gdb** 12 ou plus récent et **OpenOCD** 0.12.0 ou plus récent, que vous installez vous-même (par exemple les builds xPack, ou `gdb-multiarch` et `openocd` sous Ubuntu) ; utilisez ensuite **Vérifier les dépendances** sur la page du plugin. Les pilotes de sonde et les autorisations USB sont à votre charge.
- **gdb-elf** et **gdb-debug** : des scripts installés automatiquement.
- Pour les sessions en direct, une sonde de débogage déclarée dans `lab/resources.json` (paramètre `lab-resources`, facultatif) par VID, PID et numéro de série USB, avec un profil : `stm32f4-stlink` (Cortex-M4F) ou `stm32g0-stlink` (Cortex-M0+). La section **Configuration** de la page du plugin indique son état.
- L’ELF correspondant exactement à l’image présente sur la carte.

## Utilisation

- « Examinez build/app.elf : architecture, symboles et informations de débogage. » (compétence `debug-sessions`)
- « La carte sur stlink1 est bloquée. Prenez un instantané avec build/app.elf, gardez le cœur arrêté et décodez la faute. »
- « Lisez les variables counter et state.mode dans le même instantané. »
- « Exécutez jusqu’à atteindre la fonction sample, avec un délai de 30 secondes. »
- « Avancez de trois lignes de source à partir d’ici. »

L’agent demande ce que pilote le firmware (relais, moteurs, éléments chauffants) avant une session en direct, et ne laisse le cœur repartir à la sortie qu’avec votre accord pour un firmware qui actionne du matériel. Quand l’ELF ne correspond pas à la flash, il présente les symboles comme inconnus au lieu de deviner.

## Risques et approbations

- Sûr, exécuté sans demander : examen et diagnostic d’ELF, versions des outils et le nettoyage `release`.
- Écriture appareil : `snapshot`, `break` et `step`. Chacune arrête le cœur au moyen de la sonde, et `break` et `step` exécutent le firmware ; la politique de sortie choisie (arrêté ou reprise) s’applique à la fin. Rien n’est écrit en mémoire ni en flash. Les modes Demander et Modification auto demandent avant chacune.
- Irréversible : toute session avec `--firmware-effect actuates`, pour un firmware qui pilote des actionneurs : l’arrêter peut laisser une sortie dans son dernier état, et l’exécuter le laisse agir sur le matériel. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.
- Bloqué : l’appel direct de GDB ou d’OpenOCD.

## Limites

- Windows x64 et Linux x64. Pas encore exécuté avec une vraie sonde et une vraie carte ; les deux profils ne sont pas vérifiés.
- Pas de prise en charge des RTOS, des registres de périphériques, des écritures en mémoire, du semihosting, de SWO/ITM ni de reprise autonome. La mémoire n’est lue que sous forme de variables nommées, de la trame empilée et des registres de faute.
- Références : https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI.html et https://openocd.org/doc/html/GDB-and-OpenOCD.html
