# Plugins

Les plugins permettent à l’agent de piloter les outils de votre poste de test : outils de programmation flash et de débogage, moniteurs série, analyseurs de bus, simulateurs, instruments de mesure. Un plugin déclare ses programmes, la façon dont VERA les installe, le niveau de risque de chaque commande et les compétences qui apprennent à l’agent à les utiliser. Chaque plugin installé possède sa propre page dans l’aide et sur sa carte.

## Trouver et installer un plugin

1. Sur la page **Plugins**, sélectionnez **Parcourir les plugins disponibles**. Filtrez par **Écosystème**, **Activité**, **Provenance**, **Maturité** ou état, ou lancez une recherche.
2. Ouvrez **Détails** pour voir ce dont le plugin a besoin, y compris les plugins et programmes requis.
3. Sélectionnez **Installer**, ou **Installer avec les dépendances** pour installer aussi les plugins requis et les programmes que VERA peut installer lui-même.
4. Vérifiez l’examen et confirmez.

Une carte vous avertit lorsque le plugin n’est pas disponible pour votre plateforme ou qu’il peut écrire sur un appareil ou le modifier de façon permanente. Les versions inférieures à 1.0.0 sont marquées **Préversion**.

## Installer un pack

**Installer un pack** installe les plugins d’un écosystème, comme ESP32, STM32 ou Electronics design. Cochez les groupes dont vous avez besoin, sélectionnez **Examiner le pack**, puis **Installer avec les dépendances**. Les plugins déjà installés ou non disponibles pour votre plateforme sont ignorés.

## Examen et confiance

Avant l’installation, VERA affiche un examen : la **Composition** (les programmes et leur provenance, les compétences, les fichiers de données, les documents) et les **Opérations**, c’est-à-dire les règles de commande du plugin regroupées par niveau de risque. Les mises à jour qui modifient des programmes, des sources ou des règles sont examinées à nouveau. Si les fichiers du plugin changent après l’installation, VERA cesse de l’utiliser jusqu’à ce que vous le réinstalliez.

Les plugins ont un niveau de confiance :

| Niveau | Origine |
|---|---|
| **Officiel** | Issu du catalogue, où il est marqué comme officiel |
| **Communauté** | Tout autre plugin du catalogue |
| **Local** | Installé par vous avec **Installer depuis un dossier…** ou **Installer depuis un zip…** |
| **Essai** | Rédigé par l’agent dans une session ; chaque commande demande une approbation, y compris en mode Contournement. **Promouvoir en local** lui accorde la confiance |

Un banc de travail peut aussi contenir des paquets de plugins dans `.vera/plugins/`. Ils ne sont utilisés qu’après que vous avez sélectionné **Examiner le plugin du banc de travail** et **Faire confiance à ce paquet** ; la confiance n’est stockée que sur cet ordinateur, et toute modification du paquet nécessite un nouvel examen.

## Activer un plugin pour un banc de travail

L’installation n’active pas un plugin. Ouvrez **Modifier le banc** → **Plugins**, cochez le plugin et sélectionnez **Enregistrer**. Seuls les plugins activés sont proposés à l’agent dans ce banc de travail.

## Dépendances

Le bloc **État** d’un plugin installé vérifie trois choses : **Dépendances**, **Configuration** et **Utilisation**. Il affiche **Prêt** uniquement lorsque les trois sont prêtes.

- **Vérifier les dépendances** recherche les programmes ; **Vérifier toutes les dépendances** le fait pour chaque plugin.
- **Installer les dépendances** installe ce que VERA peut installer lui-même (paquets Python, scripts et téléchargements à version figée) dans son propre dossier de programmes. Chaque téléchargement est vérifié par rapport à son SHA-256.
- Les programmes des fabricants, comme KiCad, LTspice ou STM32CubeProgrammer, sont marqués **Géré en externe** : installez-les en suivant le **Guide d’installation**, puis vérifiez à nouveau.
- **Réinstaller** télécharge à nouveau les copies de programmes de VERA et les remplace.
- **Installer depuis une archive de dépendances…** installe un programme à partir d’une archive que vous avez téléchargée vous-même ; VERA la vérifie par rapport au SHA-256 du plugin.

## Paramètres

Certains plugins ont besoin de réglages, signalés par **Configuration requise** et saisis dans leur section **Configuration** : par exemple des identifiants de broker MQTT, des jetons Wokwi, des clés de distributeurs pour la recherche de composants, ou un fichier du banc de travail comme une liste des ressources du poste de test. Les secrets ne sont transmis qu’à une exécution approuvée de ce plugin ; l’agent ne les voit jamais.

## Exécutions de programmes

Chaque commande que l’agent exécute passe par votre mode d’autorisation (consultez [Autorisations](permissions.md)). L’onglet **Exécutions** du panneau droit liste les exécutions du banc de travail ; **Ouvrir le journal** affiche la sortie et **Arrêter** termine un programme en cours. Les journaux sont conservés dans `.vera/runs/`.

## Mises à jour et catalogue

**Rechercher des mises à jour** recherche de nouvelles versions des plugins ; une mise à jour affiche **Mettre à jour vers …**. VERA vérifie aussi une fois par jour, sauf si les mises à jour sont désactivées dans les [Paramètres](settings.md). Sous **Paramètres du catalogue**, vous choisissez le **Canal** (**Stable** ou **Préversion**) et, si vous le souhaitez, une **URL du catalogue**, par exemple le miroir de votre entreprise. VERA n’utilise un catalogue que si sa signature correspond ; sinon, il affiche les plugins fournis avec VERA.

**Désinstaller** et **Exporter le zip** se trouvent sous **Plus d’actions** sur la carte d’un plugin installé. Sans réseau, consultez [Installation hors ligne](offline-install.md).
