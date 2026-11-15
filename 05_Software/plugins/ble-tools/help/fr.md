# Outils BLE (découverte et GATT)

Outils BLE permet à l’agent de rechercher des appareils Bluetooth Low Energy pendant une durée limitée et d’exécuter des opérations GATT contrôlées sur les appareils que vous avez déclarés : confirmer l’identité d’un appareil par rapport à son profil, lister ses services, lire les caractéristiques déclarées, enregistrer des notifications et envoyer une écriture nommée. Un appareil est identifié par son adresse, jamais par son nom ni par la force de son signal. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **ble-tool** : un script épinglé sur Bleak 3.1.0, installé automatiquement par **Installer les dépendances** sur la page du plugin.
- Un adaptateur Bluetooth activé sur cet ordinateur : Windows 11 ou Linux avec BlueZ 5.55 ou plus récent.
- `lab/resources.json` dans le banc de travail (paramètre `lab-resources`) : une entrée `ble-device` par appareil avec son alias, son adresse, son profil et éventuellement son numéro de série. La section **Configuration** de la page du plugin indique si le fichier est valide.
- Un profil d’appareil : un fichier JSON qui déclare les services, les caractéristiques, les charges utiles, les unités, les limites, les opérations autorisées et les écritures nommées de l’appareil. Un exemple est fourni avec le plugin.
- L’appairage, si nécessaire, est une étape qui vous revient, dans les paramètres Bluetooth du système d’exploitation.

## Utilisation

- « Recherchez des appareils BLE pendant 10 secondes. » (compétence `ble-devices`)
- « Écrivez un profil et une entrée lab/resources.json pour le thermomètre à l’adresse C4:7F:51:00:12:34. » (compétence `ble-profiles`)
- « Identifiez l’appareil thermo à l’aide de ble/thermo.json. »
- « Enregistrez les notifications de température de thermo pendant 30 secondes. »
- « Réglez le niveau du ventilateur de l’appareil fan sur 40. »

L’agent vous demande quelle adresse correspond à l’appareil ; il n’en choisit jamais une d’après un nom. Une connexion, une lecture ou une écriture qui échoue n’est pas relancée.

## Risques et approbations

- Sûr, exécuté sans demander : vérification hors ligne d’un profil et rapports d’exécution.
- Lecture appareil : recherche, identification, liste des services, et lecture ou abonnement à des caractéristiques sans effet de bord.
- Écriture appareil : lecture ou abonnement à une caractéristique que le profil marque comme modifiant l’état, envoi d’une écriture de configuration ou d’actionnement (elle peut modifier un réglage ou faire bouger, commuter ou piloter du matériel, et Arrêter ne l’annule pas), et libération d’une connexion.
- Irréversible : une écriture persistante que l’appareil enregistre et conserve après une réinitialisation. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.

En mode Demander, VERA demande avant chaque commande de lecture appareil et d’écriture appareil ; le mode Modification auto exécute les commandes de lecture appareil sans demander.

## Limites

- Windows x64 et Linux x64 ; Windows 10 n’est pas pris en charge. Sous Linux, une recherche doit être active (`--active`), et une écriture avec réponse est limitée à 20 octets.
- Pas d’appairage, de saisie de code PIN, d’écriture brute, de mise à jour de firmware, d’advertising, de Bluetooth Classic ni de modification des paramètres Bluetooth.
- Seuls un backend simulé et une vraie recherche passive sous Windows 11 sont vérifiés ; les opérations sur de vrais appareils et Linux ne sont pas encore prouvés.
- Référence : https://bleak.readthedocs.io/en/latest/
