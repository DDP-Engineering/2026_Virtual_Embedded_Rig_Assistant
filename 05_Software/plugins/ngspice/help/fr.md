# Simulation de circuits ngspice

Ce plugin permet à l’agent de simuler des circuits localement avec ngspice. Il exécute des analyses de point de fonctionnement, DC, AC, transitoires et de bruit de votre netlist SPICE (écrite à la main ou exportée depuis KiCad) avec des modèles locaux, effectue des mesures sur des fenêtres déclarées (ondulation, dépassement, établissement, RMS, puissance moyenne), vérifie des critères de réussite ou d’échec, fait varier les paramètres et la température, exécute un Monte Carlo avec graine, compare des exécutions et rédige des rapports. Les netlists sont vérifiées avant l’exécution du moteur, et chaque exécution écrit un nouveau dossier sous `electronics-results/` avec le journal, la netlist effective, les hashs des entrées, un fichier de séries, un graphique, un fichier de résultat et un rapport.

## Prérequis

- **ngspice 42 ou plus récent.** Sous Windows, **Installer les dépendances** télécharge le build officiel épinglé ngspice-47 dans le dossier des programmes de VERA ; VERA utilise aussi votre propre copie dans `C:\Spice64`. Sous Ubuntu, il n’existe pas de binaire officiel : installez-le vous-même avec `sudo apt install ngspice`. La section **Dépendances** de la page du plugin indique ce qui a été trouvé.
- **ngspice-tool**, un script Python du plugin, que VERA installe lui-même. L’agent passe toujours par lui.
- Aucun matériel, aucun autre plugin et aucune configuration.

## Utilisation

L’agent utilise la compétence `circuit-simulation`. Il déclare l’analyse, les fenêtres de mesure et les critères avant de regarder les résultats.

- « Vérifiez circuits/buck.cir et listez ses modèles et ses sous-circuits. »
- « Lancez une analyse transitoire de 2 ms du convertisseur buck ; l’ondulation de sortie de 1 ms à 2 ms doit être d’au plus 50 mV. »
- « Mesurez la puissance moyenne dans l’interrupteur de 1 ms à 2 ms. »
- « Faites varier RLOAD entre 1k et 3k et comparez les exécutions. »
- « Lancez 50 tirages Monte Carlo avec une tolérance de 5 % sur RLOAD, graine 7, et rédigez un rapport. »
- « Construisez un réseau thermique RC à constantes localisées pour le régulateur et trouvez sa température en régime permanent. »

## Risques et approbations

Toutes les opérations de ngspice-tool (validate, run, sweep, measure, compare, report) sont classées **Sûr** : elles ne font que simuler sur votre ordinateur, ne modifient jamais la netlist ni ses modèles, et s’exécutent sans demander. L’exécution directe de ngspice est classée **Bloqué**, car le bloc de contrôle d’une netlist peut exécuter des commandes shell et écrire des fichiers.

## Limites

- Windows x64 et Linux x64.
- Refusés avant l’exécution du moteur : les blocs `.control`, les cartes inconnues, les lignes `*#` et `;#` (ngspice les exécute comme des commandes), les instances XSPICE `A`, le chargement de code, `shell`, les inclusions hors du banc de travail, les modèles ou sous-circuits non définis et les instances de sous-circuits avec un mauvais nombre de broches.
- Les cartes d’analyse de la netlist (`.tran`, `.ac`, `.meas`, `.print`) ne sont pas exécutées ; c’est la requête qui décide de l’analyse.
- Une exécution qui ne converge pas est signalée, et non relancée avec des réglages de solveur assouplis.
- Une simulation n’est pas une mesure sur le matériel : le résultat ne vaut que ce que valent les modèles.
