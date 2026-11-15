# STM32CubeProgrammer

Ce plugin permet à l’agent de programmer des composants STM32 avec votre propre STM32CubeProgrammer (STM32_Programmer_CLI). Il se connecte par un ST-LINK ou par un bootloader UART, USB DFU, SPI, I2C ou CAN, lit les mémoires, flashe et vérifie des images, efface, réinitialise, et lit ou modifie les option bytes. Utilisez-le pour programmer une carte STM32 ou examiner son état de protection.

## Prérequis

- **STM32CubeProgrammer**, que vous installez vous-même depuis https://www.st.com/en/development-tools/stm32cubeprog.html (un compte ST est requis), ou STM32CubeIDE, qui l’inclut. VERA ne le télécharge jamais ; il le cherche dans les dossiers d’installation standard et dans le PATH.
- Sous Linux, une installation personnalisée nécessite un lien `stm32_programmer_cli` en minuscules dans le PATH.
- Une sonde ST-LINK ou une connexion bootloader, et la carte cible. Le programme d’installation ajoute les pilotes ST-LINK sous Windows ; sous Linux, vous installez vous-même les règles udev de ST.
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `stm32-flash` et `stm32-option-bytes`. Il convient avec vous de la sonde et de l’interface avant de se connecter.

- « Listez les sondes ST-LINK connectées. »
- « Connectez-vous en SWD et indiquez-moi l’ID du composant et la taille de la flash. »
- « Flashez build/app.elf en SWD, vérifiez-le et réinitialisez la carte. »
- « Lisez 4 Ko de flash à partir de 0x08000000 dans captures/flash.bin. »
- « Affichez les option bytes et expliquez chaque champ. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : aide, version, réglages de sortie, outils sur les fichiers de l’hôte et liste des sondes sans connexion.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : connexion, lecture, vérification, réinitialisations, halt/run/step et affichage des option bytes, de l’OTP ou de l’état du produit. Les réinitialisations affectent le programme en cours d’exécution.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : écriture, effacement ou remplissage de la flash ou de la RAM, exécution de code, écriture des registres du cœur et modifications de la pile sans fil ; ainsi que les commandes inconnues. Une image hex, srec ou ELF peut contenir des segments d’option bytes ou d’OTP, qu’une écriture programme aussi.
- **Irréversible** (demande, et vous tapez la commande, par exemple `-ob`) : écritures d’option bytes, régression de la protection en lecture et de TrustZone (effacement complet), verrouillage et déverrouillage RDP, OTP, clés, firmware sécurisé, état du produit, authentification de débogage, licences HSM et commutation de l’alimentation de la cible. Le niveau RDP 1 ne se retire que par un effacement complet ; le niveau RDP 2 est permanent et bloque définitivement l’accès au débogage. En mode **Contournement — accès complet**, ces commandes s’exécutent sans demander.
- **Bloqué** : les fichiers de script, car VERA ne peut pas classer les commandes qu’ils contiennent.

## Limites

- Windows x64 et Linux x64. Les règles ont été établies avec STM32CubeProgrammer 2.23.0 ; les commandes des versions ultérieures comptent comme inconnues tant que les règles ne les listent pas.
- Les fichiers que la CLI écrit sur votre ordinateur (lectures mémoire, journaux, vidages de registres) ne nécessitent pas d’approbation séparée.
- Le plugin ne s’est pas encore connecté à une vraie carte et n’a pas encore modifié d’option bytes.
