# ESP32 ESP-IDF

ESP32 ESP-IDF permet à l’agent de compiler et de réparer des projets ESP-IDF, d’indiquer la taille des firmwares, de flasher le résultat sur une carte et d’analyser les paniques ESP32 : il décode les backtraces Guru Meditation en lignes de source avec l’ELF correspondant et lit les core dumps de la puce. Il utilise l’ESP-IDF que vous avez installé et sélectionné vous-même.

## Prérequis

- **ESP-IDF 5.4 ou plus récent (inférieur à 7)**, installé avec l’ESP-IDF Installation Manager (EIM). VERA trouve `idf.py` grâce à EIM mais ne l’installe jamais. Installez ESP-IDF avec EIM, sélectionnez la version avec `eim select`, ajoutez `eim` au PATH, démarrez VERA, puis utilisez **Vérifier les dépendances** sur la page du plugin. Guide : https://docs.espressif.com/projects/idf-im-ui/en/latest/
- Les décodeurs `addr2line` Xtensa et RISC-V des chaînes d’outils ESP-IDF, également installés avec EIM. Pour une racine d’outils personnalisée, démarrez VERA avec `IDF_TOOLS_PATH` défini sur cette racine.
- Les pilotes USB de votre carte, installés par vous.
- Le plugin **serial-monitor**, qui trouve le port de la carte et capture la console. **Installer avec les dépendances** l’ajoute.
- Aucun paramètre de configuration.

## Utilisation

- « Compilez le projet de firmware/ et corrigez la première erreur de compilation. » (compétence `esp32-build-fix`)
- « Activez le core dump en flash dans sdkconfig.defaults, reconfigurez et recompilez. »
- « Quels composants occupent le plus de flash ? »
- « Flashez le build sur la carte du COM5. »
- « La carte a planté avec un Guru Meditation. Capturez-le sur COM5 et décodez la backtrace avec l’ELF flashé. » (compétence `esp32-panic`)
- « Lisez le core dump de la carte du COM5. »

L’agent ne modifie jamais le `sdkconfig` généré ; il modifie `sdkconfig.defaults`, reconfigure et vérifie la configuration effective. Il ne décode une backtrace qu’avec l’ELF du build exact qui a été flashé et le signale quand la correspondance est inconnue.

## Risques et approbations

- Sûr, exécuté sans demander : compilation, rapports de taille, `set-target`, `fullclean`, `reconfigure` et les décodeurs addr2line. `set-target` et `fullclean` suppriment la sortie de build générée.
- Lecture appareil : `coredump-info`, qui lit la partition de core dump et peut réinitialiser la carte.
- Écriture appareil : `flash`, `app-flash`, `erase-flash` et `erase-otadata`, qui écrasent le firmware ou des données sur la puce ; effacer les données OTA change l’application sélectionnée.
- Irréversible : les commandes `efuse-*` et `secure-*`, qui peuvent modifier la puce de façon permanente. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement. Une réparation de build n’en a jamais besoin.
- Bloqué : `monitor`, `menuconfig`, `gdb` et `gdbtui`, qui sont interactifs, y compris `flash monitor`. Utilisez le moniteur série pour capturer la console.

En mode Demander, VERA demande avant chaque commande de lecture appareil et d’écriture appareil ; le mode Modification auto exécute les commandes de lecture appareil sans demander.

## Limites

- Windows x64 et Linux x64.
- Le transport des commandes EIM est vérifié avec EIM 0.20.1. Une vraie compilation ESP-IDF, un flashage et un décodage de panique sur du matériel ne sont pas encore prouvés.
- Références : https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-py.html et https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html
