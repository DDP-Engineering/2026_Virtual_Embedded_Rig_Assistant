# Instruments de banc SCPI

Ce plugin permet à l’agent de travailler avec les instruments de banc que déclare votre banc de travail : un multimètre, un oscilloscope ou une alimentation, au moyen de PyVISA. Il identifie un instrument, lit des valeurs avec leurs unités, capture des formes d’onde, modifie des réglages et alimente une carte depuis une sortie d’alimentation pendant une durée de maintien limitée. Chaque commande provient d’un profil du paquet ; il n’y a ni SCPI brut ni recherche sur le réseau. Chaque instrument est réservé pour l’exécution, et ses sorties sont coupées après Arrêter, un dépassement de délai ou un plantage, ou bien l’état est signalé comme inconnu. Les résultats vont dans `embedded-lab-results/`.

## Prérequis

- **scpi**, un script Python avec PyVISA 1.16.2 et pyvisa-py 0.8.1 épinglés, que VERA installe lui-même avec **Installer les dépendances**.
- **Le registre du banc** `lab/resources.json` dans le banc de travail (obligatoire). Chaque entrée comporte un alias, la ressource VISA, le numéro de série, le profil et les limites du banc. La section **Configuration** de la page du plugin indique si le fichier est présent et valide.
- **Instruments pris en charge** : Keysight 34460A/34461A, Rigol DS1054Z/DS1074Z/DS1104Z (et Plus), Rigol DP832/DP832A, en TCPIP, USBTMC ou (DP800) série.
- Pour l’USBTMC : libusb 1.0 et l’accès au périphérique, que vous configurez vous-même (sous Ubuntu `libusb-1.0-0` et une règle udev ; sous Windows un pilote WinUSB, par exemple avec Zadig). Facultativement, une bibliothèque VISA d’un fabricant (NI-VISA, Keysight IO Libraries).

## Utilisation

L’agent utilise les compétences `bench-instruments` et `instrument-profiles`.

- « Identifiez l’alimentation psu et montrez ses limites. »
- « Lisez la tension continue sur le multimètre dmm, gamme 10 V. »
- « Capturez CHAN1 de l’oscilloscope avec 1 ms/div et 0,5 V/div. »
- « Alimentez la carte depuis psu CH1 à 3,3 V, 0,2 A pendant 10 minutes pendant que vous la flashez. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : informations sur les profils et le registre, et recalcul d’une capture ; aucun instrument n’est ouvert.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : liste des ports série locaux et des périphériques USB, identify, read, status et capture (qui ne règle que le transfert de la forme d’onde, pas l’acquisition).
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : modification des réglages, et coupure de toutes les sorties (y compris le nettoyage de VERA).
- **Irréversible** (demande, et vous tapez le mot de confirmation `output`) : mise sous tension d’une sortie d’alimentation pendant la durée de maintien ; elle est coupée ensuite et relue. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

## Limites

- Windows x64 et Linux x64. Aucun profil n’a encore été vérifié avec un vrai instrument, si bien qu’un résultat qui a modifié des réglages ou alimenté une sortie porte l’avertissement `profile-unverified` ; Ubuntu natif et les bibliothèques VISA des fabricants n’ont pas été exécutés.
- Un instrument dont l’identité ne correspond à aucun profil n’a droit qu’à identify.
- VERA ne peut pas empêcher l’accès des autres programmes, et rien ne peut couper une sortie si l’ordinateur entier ou VERA est perdu.
