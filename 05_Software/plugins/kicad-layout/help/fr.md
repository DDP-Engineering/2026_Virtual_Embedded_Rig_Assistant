# Placement de PCB et routage local KiCad

Placement de PCB et routage local KiCad permet à l’agent d’apporter des modifications contrôlées à une carte KiCad 10 sur une copie candidate, au moyen de l’API IPC officielle de KiCad. Il déplace, fait pivoter et aligne des empreintes, et ajoute des zones d’exclusion ainsi que des pistes et vias locaux. Chaque requête est d’abord vérifiée (éléments verrouillés, nets, couches, contour), puis le candidat est contrôlé par DRC et recherche d’éléments non connectés, et présenté avec des aperçus avant et après. Votre carte n’est modifiée que si vous demandez d’appliquer un candidat conforme. Les dossiers d’exécution vont dans `electronics-results/<run-id>/` du banc de travail.

## Prérequis

- **KiCad 10**, que vous installez vous-même depuis https://www.kicad.org/download/ (sous Ubuntu depuis le PPA KiCad 10). Utilisez ensuite **Vérifier les dépendances** sur la page du plugin.
- L’API de KiCad activée : dans KiCad, **Preferences > Plugins**, activez le serveur d’API.
- **kicad-layout-tool** : un script du plugin avec son client d’API, installé automatiquement par **Installer les dépendances**.
- Une seule fenêtre KiCad détenant l’API : fermez les autres fenêtres KiCad avant d’ouvrir un candidat. Le candidat s’ouvre dans sa propre fenêtre d’éditeur de PCB ; n’y touchez pas pendant que l’agent travaille.
- Aucun plugin requis et aucun paramètre de configuration.

## Utilisation

- « Ouvrez un candidat de boards/sensor.kicad_pcb. » (compétence `kicad-layout`)
- « Placez C3 à côté de la broche VCC de U1 et faites-le pivoter de 90 degrés. »
- « Ajoutez une piste VCC de 0,25 mm de C3 à U1 et un via GND à côté. »
- « Gardez la zone sous l’antenne libre de pistes et de vias. »
- « Montrez-moi le rapport et les aperçus, puis appliquez le candidat à la carte. »

Une requête refusée ne modifie rien. L’agent ne déverrouille jamais de composants de lui-même ; il vous le demande.

## Risques et approbations

- Sûr, exécuté sans demander : ouverture, modification et fermeture d’un candidat. Ces opérations ne travaillent que sur la copie du dossier d’exécution et n’écrivent jamais votre carte.
- Bloqué : les autres commandes `kicad-cli`, car `kicad-cli` réécrit des fichiers dans le dossier de projet qu’il lit.
- Application d’un candidat : `apply_candidate` de VERA écrit un candidat dont les objectifs sont atteints par-dessus la carte source, avec la même approbation que toute écriture de fichier : refusée en mode Lecture seule, demandée en mode Demander. Elle est refusée si la source ou le candidat a changé, ou tant que la carte est ouverte dans KiCad ; enregistrez ou abandonnez d’abord vos modifications dans KiCad, puis fermez-la.

## Limites

- Windows x64 et Linux x64. Ubuntu natif n’est pas encore vérifié pour cette version.
- L’API de KiCad 10 nécessite une fenêtre d’éditeur de PCB ; il n’y a pas de mode sans interface.
- Le DRC de KiCad ne prouve ni l’intégrité du signal, ni le comportement RF, ni l’aptitude thermique.
- Pas de placement global, d’autoroutage, de modification de schéma ni de remplacement d’empreinte. Pour l’autoroutage, utilisez le plugin freerouting.
- Référence : https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/
