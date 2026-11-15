# Tests HIL

Tests HIL exécute des plans de test hardware-in-the-loop finis sur une vraie carte. Un plan est un fichier JSON, jamais un script : préparation, firmware et son SHA-256, câblage, effet du firmware sur le monde extérieur, étapes, budget de temps et nettoyage. VERA compile chaque étape en une opération d’un autre plugin activé, demande une seule approbation pour tout le plan, réserve la sonde, les ports série et les instruments, et exécute les étapes. Le nettoyage s’exécute toujours, y compris après Arrêter ou un dépassement de délai. Les résultats et les rapports (JSON, JUnit, HTML, Markdown) vont dans `embedded-lab-results/<run-id>/` du banc de travail.

## Prérequis

- **hil** : un script du plugin, installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Les plugins dont le plan utilise les opérations, activés dans le banc de travail : probe-rs, esp32-esptool, serial-monitor, scpi-instruments et lab-validation.
- La carte avec sa sonde ou son port série, et les instruments déclarés dans `lab/resources.json` quand le plan les désigne par alias.
- Le fichier de firmware à tester ; le plan enregistre son SHA-256.

## Utilisation

- « Écrivez un test HIL de fumée pour le build blinky sur la NUCLEO-F401RE : flasher, réinitialiser, attendre READY, envoyer ping et vérifier la fréquence de clignotement de la LED à l’oscilloscope. » (compétence `hil-planning`)
- « Vérifiez le plan hil/blinky.json et montrez-moi chaque opération et son risque. »
- « Exécutez hil/blinky.json en arrière-plan. »
- « Pourquoi le plan a-t-il échoué ? Montrez l’étape en échec et son journal. »

Avant d’écrire un plan, l’agent vous demande ce que pilote le firmware (relais, moteurs, éléments chauffants, sorties) et ne choisit jamais un effet plus faible en cas de doute. `hil check` ne touche à aucun matériel et affiche le développement complet du plan pour que vous l’examiniez.

## Risques et approbations

- Sûr, exécuté sans demander : `hil check` et `hil report`.
- `hil run` : une seule approbation pour tout le plan, au risque le plus élevé de ses opérations tel que les autres plugins les classent, et de l’effet déclaré du firmware quand le plan flashe ou réinitialise ; jamais inférieur à lecture appareil. Un plan irréversible vous demande de taper l’identifiant du plan. Un plan, un firmware ou un registre modifié après l’approbation est refusé.
- Les étapes de flashage, de réinitialisation, de sortie et de configuration s’exécutent une seule fois ; elles ne peuvent être ni relancées ni répétées.

Si une exécution se termine avec l’état physique `unknown`, rien ne garantit que le banc est sûr ; l’agent vous en informe d’abord.

## Limites

- Windows x64 et Linux x64. Testé sous Windows avec des substituts uniquement ; Ubuntu natif et une vraie carte n’ont pas encore été exécutés.
- Les étapes s’exécutent une à la fois, sauf les captures UART en arrière-plan et les maintiens d’alimentation. Lancez une capture du journal de démarrage en arrière-plan avant la réinitialisation, sinon le journal est perdu.
- VERA ne peut pas empêcher l’accès des programmes extérieurs à VERA.
- Les étapes GDB, Zephyr, PlatformIO et Twister ne sont pas disponibles.
