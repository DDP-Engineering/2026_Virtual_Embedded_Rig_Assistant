# Simulation de circuits LTspice

Ce plugin permet à l’agent de simuler des circuits en mode batch avec votre propre copie de LTspice sous Windows. Il exécute des analyses de point de fonctionnement, DC, AC, transitoires et de bruit d’une netlist SPICE ou d’un schéma LTspice .asc, fait varier les paramètres et la température, exécute un Monte Carlo avec graine, effectue des mesures sur des fenêtres déclarées (ondulation, dépassement, établissement, RMS, puissance moyenne) et vérifie des critères de réussite ou d’échec. Les requêtes utilisent le même format que le plugin ngspice : une même requête peut donc s’exécuter sur les deux moteurs et les résultats peuvent être comparés. Chaque exécution écrit un nouveau dossier sous `electronics-results/` avec les entrées, le journal et le fichier raw de LTspice, un graphique et un rapport.

## Prérequis

- **LTspice 26 ou plus récent**, que vous installez vous-même depuis https://www.analog.com/ltspice (LTspice64.msi, Windows 10/11 x64). VERA le trouve dans le dossier d’installation par utilisateur ou pour tous les utilisateurs et ne l’installe jamais. Si l’installation par utilisateur échoue avec l’erreur 2503, installez-le pour tous les utilisateurs depuis une invite administrateur : `msiexec /i LTspice64.msi ALLUSERS=1`.
- **ltspice-tool**, un script Python du plugin, que VERA installe lui-même. L’agent passe toujours par lui.
- Aucun matériel, aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise la compétence `ltspice-simulation`.

- « Vérifiez circuits/buck.cir et ses inclusions avant que nous le simulions. »
- « Convertissez circuits/filter.asc en netlist et lancez un balayage AC de 10 Hz à 100 kHz ; le point à -3 dB doit être au-dessus de 159 Hz. »
- « Lancez une analyse transitoire du convertisseur buck et mesurez l’ondulation de sortie une fois le régime établi. »
- « Lancez 50 tirages Monte Carlo avec une tolérance de 5 % sur RLOAD, graine 7. »
- « Exécutez la même requête avec ngspice et comparez les mesures. »

## Risques et approbations

Toutes les opérations de ltspice-tool (validate, convert, run, sweep, measure, compare, report) sont classées **Sûr** : elles ne font que simuler sur votre ordinateur, ne modifient jamais la netlist, le schéma, ses modèles ni les bibliothèques de LTspice, et s’exécutent sans demander. L’exécution directe de LTspice est classée **Bloqué**, car une netlist peut écrire des fichiers n’importe où et LTspice ouvre sa fenêtre sans mode batch.

## Limites

- Windows x64 uniquement ; le plugin n’est pas proposé sous Linux ni macOS.
- Avant l’exécution de LTspice, ltspice-tool refuse les directives qui lisent ou écrivent des fichiers (comme `.wave`), les cartes inconnues, les fichiers chiffrés ou non UTF-8 et les inclusions hors du banc de travail et de la bibliothèque de LTspice. Un nœud nommé par exemple `profile` est également refusé, car LTspice reconnaît `file` par préfixe.
- Les cartes d’analyse et `.meas` de la netlist ne sont pas exécutées ; c’est la requête qui décide de l’analyse.
- Une section de bibliothèque nécessite un nom de fichier entre guillemets : `.lib "models/corners.lib" TT`.
- Une simulation n’est pas une mesure sur le matériel : le résultat ne vaut que ce que valent les modèles.
