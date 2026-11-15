# Analyse de schémas et de PCB KiCad

Analyse de schémas et de PCB KiCad permet à l’agent d’analyser des projets KiCad 10 sans les modifier. Il lit la hiérarchie des feuilles, les instances de symboles, les nets, les couches de la carte, l’empilement, les pistes et les classes de nets ; exécute l’ERC et le DRC de KiCad et présente chaque violation avec ses objets et ses positions ; et produit une nomenclature (BOM), la netlist de KiCad et des exports d’inspection ou de fabrication (PDF ou SVG du schéma et de la carte, Gerber, fichiers de perçage et de position), chacun vérifié. KiCad ne s’exécute que sur une copie du projet. Chaque exécution crée un dossier sous `electronics-results/` dans le banc de travail avec `result.json`, `report.md` et les fichiers propres à KiCad.

## Prérequis

- **KiCad 10**, que vous installez vous-même depuis https://www.kicad.org/download/ (sous Ubuntu depuis le PPA KiCad 10). Utilisez ensuite **Vérifier les dépendances** sur la page du plugin.
- **kicad-tool** : un script du plugin, installé automatiquement par **Installer les dépendances**.
- Un projet KiCad (`.kicad_pro`, `.kicad_sch` ou `.kicad_pcb`) dans le banc de travail. Les fichiers de KiCad 8 ou 9 sont traités avec un avertissement ; les fichiers plus anciens ou plus récents sont refusés et doivent d’abord être enregistrés dans KiCad 10.
- Aucun plugin requis et aucun paramètre de configuration.

## Utilisation

- « Examinez le schéma de hardware/sensor.kicad_pro. » (compétence `schematic-review`)
- « Lancez l’ERC et listez les violations avec leurs feuilles et leurs positions. »
- « Lancez le DRC sur la carte avec les zones remplies à nouveau, et vérifiez la parité avec le schéma. » (compétence `pcb-review`)
- « Exportez la BOM et la netlist. »
- « Créez les fichiers Gerber, de perçage et de position pour une carte à deux couches. »

Dans un examen, l’agent sépare les constats de KiCad de ses propres observations et marque chaque observation comme un fait ou une hypothèse. Il ne déclare pas un net ou un composant correctement dimensionné sans les exigences électriques qui le justifient. Zéro violation DRC ne valide ni le fonctionnement, ni la capacité en courant, ni l’impédance, ni les chemins de retour.

## Risques et approbations

- Sûr, exécuté sans demander dans tous les modes d’autorisation : toutes les opérations `kicad-tool`. Elles travaillent sur une copie temporaire et ne créent que de nouveaux dossiers d’exécution ; le projet n’est jamais modifié, et une exécution dont les sources ont changé entre-temps est écartée.
- Bloqué : l’exécution directe de `kicad-cli`, hors version ou aide, car il réécrit des fichiers dans le dossier de projet qu’il lit et peut enregistrer ou mettre à niveau un projet.

Il n’y a aucune commande de lecture appareil, d’écriture appareil ni irréversible.

## Limites

- Windows x64 et Linux x64. Vérifié avec KiCad 10.0.8 sous Windows 11 ; Ubuntu x64 natif est en attente.
- L’ERC et le rapport d’examen refusent un projet dont le contrôle des modèles de simulation de l’ERC est activé ; réglez ce contrôle sur ignorer.
- Pas de modification de schéma ou de carte (voir le plugin kicad-layout), pas d’export de modèles 3D, pas de jobsets ni de mises à niveau.
- Référence : https://docs.kicad.org/10.0/en/cli/cli.html
