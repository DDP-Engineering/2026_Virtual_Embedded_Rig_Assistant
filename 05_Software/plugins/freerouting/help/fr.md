# Autorouteur Freerouting (local)

L’autorouteur Freerouting permet à l’agent d’autorouter un candidat de carte KiCad 10 sur cet ordinateur avec Freerouting 2.5.0. Il exporte un DSN Specctra à partir du candidat enregistré d’une exécution kicad-layout, le route hors ligne avec un budget fini de passes et de temps en conservant le cuivre existant et verrouillé, et transforme les nouvelles pistes et vias en requête kicad-layout. kicad-layout applique ensuite cette requête au candidat et la vérifie par DRC. La carte ne quitte jamais l’ordinateur, et la carte source n’est modifiée que si vous approuvez l’application d’un candidat conforme.

## Prérequis

- **Freerouting** 2.5.0 et un environnement d’exécution Java Eclipse Temurin 25 : **Installer les dépendances** sur la page du plugin télécharge les deux et vérifie leur SHA-256. Aucune installation de Java n’est nécessaire.
- **freerouting-tool** : un script du plugin, installé automatiquement.
- **KiCad 10**, que vous installez vous-même depuis https://www.kicad.org/download/ (sous Ubuntu depuis le PPA KiCad 10) ; utilisez ensuite **Vérifier les dépendances**. VERA n’installe jamais KiCad.
- Le plugin **kicad-layout**, qui ouvre le candidat et applique les routes. **Installer avec les dépendances** l’ajoute.
- Une carte dont les composants sont placés : Freerouting ne fait que router.
- Aucun paramètre de configuration.

## Utilisation

- « Ouvrez un candidat de boards/sensor.kicad_pcb et autoroutez-le. » (compétence `freerouting`)
- « Routez uniquement les nets VIN et GND du candidat ouvert. »
- « Relancez le routage avec un budget de 20 minutes. »
- « Appliquez les routes, lancez le DRC et montrez-moi le rapport et les aperçus. »
- « Appliquez le candidat à la carte source. »

L’agent indique combien de connexions restent non routées ; le DRC et le nombre de non-connexions proviennent de KiCad, pas de Freerouting. Freerouting n’est pas un optimiseur : son résultat est un routage, pas le meilleur. Les connexions restantes peuvent être routées à la main avec kicad-layout ou après avoir déplacé des composants.

## Risques et approbations

- Sûr, exécuté sans demander : `freerouting-tool route`, qui travaille sur une copie du candidat et n’écrit que dans le dossier d’exécution, ainsi que la version ou l’aide de KiCad.
- Bloqué : l’exécution directe de Java, de l’archive Freerouting ou d’autres commandes `kicad-cli`, car `kicad-cli` réécrit des fichiers dans le dossier de projet qu’il lit.

L’application des routes au candidat et l’application du candidat à la carte source sont des étapes de kicad-layout ; l’écriture de la carte source attend votre approbation.

## Limites

- Windows x64 et Linux x64.
- Un projet avec des règles DRC personnalisées (`.kicad_dru`) est refusé, sauf si vous acceptez de router sans elles ; Freerouting ne peut pas les suivre, et le DRC après la modification les vérifie toujours.
- Quand le budget de temps est épuisé, Freerouting est arrêté et aucune requête n’est écrite.
- Freerouting fonctionne entièrement hors ligne : sa vérification de version, ses statistiques d’utilisation, son interface graphique et ses serveurs sont désactivés.
- Référence : https://github.com/freerouting/freerouting
