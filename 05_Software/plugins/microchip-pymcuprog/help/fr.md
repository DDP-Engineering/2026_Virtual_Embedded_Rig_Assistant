# Microchip pymcuprog (AVR, PIC)

Ce plugin permet à l’agent d’identifier, de programmer, de vérifier et d’effacer des composants Microchip AVR (UPDI) et PIC avec pymcuprog, de relire leurs mémoires, et de lire ou modifier les fusibles et les mots de configuration. Il fonctionne avec un kit Curiosity Nano ou Xplained doté d’un nEDBG, un PICkit 4 ou un MPLAB Snap en mode AVR, un Atmel-ICE ou un adaptateur SerialUPDI.

## Prérequis

- **pymcuprog 3.19** (inférieur à 4), un paquet Python que VERA installe lui-même avec **Installer les dépendances**.
- Un programmateur ou un kit pris en charge et la carte cible. Un adaptateur SerialUPDI est n’importe quel adaptateur série USB avec une résistance entre RX, TX et UPDI.
- Sous Windows, les outils USB ne nécessitent aucun pilote supplémentaire. Sous Linux, vous aurez peut-être besoin des règles udev du README de pymcuprog (https://github.com/microchip-pic-avr-tools/pymcuprog) pour accéder au nEDBG, au PICkit et à l’Atmel-ICE.
- Aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise les compétences `microchip-flash` et `microchip-fuses`. Indiquez-lui quel outil et quel composant vous utilisez ; il ne les devine pas.

- « Envoyez un ping à l’ATtiny416 sur l’adaptateur SerialUPDI du COM5. »
- « Écrivez build/app.hex sur l’ATtiny416, en effaçant d’abord, puis vérifiez. »
- « Lisez les 64 premiers octets de la flash et enregistrez l’EEPROM dans captures/eeprom.hex. »
- « Lisez les fusibles de l’ATtiny416, enregistrez-les comme référence et expliquez chaque octet. »
- « Réglez le fusible 2 (OSCCFG) sur 0x01, puis relisez les fusibles et comparez. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : aide, version et informations de version, et conversion d’un fichier hex en UF2.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : ping, lecture, vérification, réinitialisation et mesures de tension.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : écriture de la flash, de l’EEPROM ou de la user row, effacement de la puce, redémarrage du débogueur, et effacement ou écriture d’un composant UPDI verrouillé. Un argument que pymcuprog rejetterait est aussi traité comme une écriture appareil.
- **Irréversible** (demande, et vous tapez le mot de confirmation `write` ou `erase` affiché sur la carte) : toute écriture d’un fichier hex, car un fichier Intel hex peut contenir des données de fusibles, de mots de configuration et de bits de verrouillage ; toute écriture ou tout effacement de fusible, de mot de configuration ou de bit de verrouillage ; la modification de la tension d’alimentation du kit ; toute commande avec la haute tension UPDI (12 V, `-H`). Un mauvais fusible peut désactiver l’UPDI ou le reset, et les bits de verrouillage activent la protection du code. En mode **Contournement — accès complet**, ces commandes s’exécutent sans demander.

## Limites

- Windows x64 et Linux x64.
- pymcuprog 3.19 ne pilote pas le PICkit 5.
- Les fichiers qu’une lecture vers fichier ou une conversion UF2 écrit sur votre ordinateur ne sont pas approuvés séparément.
- Le plugin n’a pas encore été testé avec un vrai outil ni une vraie carte.
