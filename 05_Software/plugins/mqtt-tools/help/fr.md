# Outils MQTT (télémétrie et commandes)

Ce plugin permet à l’agent de capturer de la télémétrie MQTT et d’envoyer des commandes contrôlées à des appareils sur un broker que configure votre banc de travail. Les captures sont limitées en durée, en nombre de messages et en octets, et conservent chaque charge utile brute avec ses indicateurs. Un message n’est envoyé que sur un topic que déclare le profil de broker, une seule fois et sans jamais être relancé, et une commande n’est jamais retenue (retained). MQTT 5 et 3.1.1 sont pris en charge ; il n’y a pas d’administration de broker. Les résultats vont dans `arduino-iot-results/`.

## Prérequis

- **mqtt-tool**, un script Python du plugin épinglé sur paho-mqtt 2.1.0, que VERA installe lui-même avec **Installer les dépendances**.
- Un **profil de broker** : un fichier JSON du banc de travail qui déclare le broker, la confiance TLS, la référence de l’identifiant, le protocole, les topics auxquels une capture peut s’abonner et sur lesquels une exécution peut publier, les limites, les schémas de charge utile et un Last Will d’état facultatif.
- L’**identifiant du broker** (`broker-credential`) : un nom d’utilisateur et un mot de passe enregistrés sous la référence que nomme le profil, par exemple `bench`. Définissez-le dans la section **Configuration** de la page du plugin. Il reste dans le magasin d’identifiants de VERA et n’est transmis qu’à une exécution approuvée de ce plugin ; ne le collez jamais dans le chat.

## Utilisation

L’agent utilise les compétences `mqtt-telemetry` et `mqtt-commands`.

- « Vérifiez le profil de broker mqtt/bench.json et testez la connexion avec l’identifiant bench. »
- « Capturez vera-test/bench1/telemetry/# pendant 30 secondes et comptez les nouveaux messages. »
- « Publiez online sur le topic d’état vera-test/bench1/status/vera. »
- « Envoyez la commande LED {"on":true} et attendez la réponse de l’appareil. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : description du client et vérification hors ligne d’un profil.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : un test de connexion et une capture limitée. Rien n’est publié, sauf le Last Will d’état si la connexion se termine anormalement.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : publication d’un message ou envoi d’une requête ; une commande peut faire agir un appareil. Arrêter ne peut pas reprendre un message envoyé.
- **Irréversible** (demande, et vous tapez le mot de confirmation affiché sur la carte) : publication d’un message retenu, que le broker conserve et remet à chaque abonné ultérieur jusqu’à son remplacement. En mode **Contournement — accès complet**, cette opération s’exécute sans demander.

Avant d’approuver une exécution qui nomme un identifiant, vérifiez l’hôte du broker dans le profil : l’identifiant est envoyé à ce broker.

## Limites

- Windows x64 et Linux x64.
- QoS 2 n’est pas pris en charge. Un message QoS 1 peut parvenir deux fois à l’appareil à cause d’une redistribution par le broker.
- Si la connexion est perdue avant l’acquittement, la remise est signalée comme inconnue.
- Le plugin n’a pas encore été exécuté avec un broker de production ni un vrai appareil.
