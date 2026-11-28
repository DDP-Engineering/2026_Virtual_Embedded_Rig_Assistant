# Outils de bus (I2C, SPI, UART)

Outils de bus permet à l’agent de dialoguer avec votre circuit en I2C, SPI et UART au moyen d’un Bus Pirate 5 ou 6 en mode binaire BPIO2. Il identifie l’adaptateur, lit la tension sur ses broches, balaie un bus I2C à la recherche des adresses qui répondent, lit et écrit des registres, exécute des transferts et des séquences d’étapes avec des pauses, et enregistre un UART sous forme de texte. Après chaque appel, l’adaptateur revient en HiZ, pull-ups et alimentation coupés, sauf si vous lui demandez de garder le bus. La capture passive et le décodage restent du ressort du plugin sigrok. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **bus-tool** : un script installé par **Installer les dépendances** sur la page du plugin.
- Un Bus Pirate 5 ou 6, passé une fois en BPIO2 avec sa commande de terminal `binmode`.
- `lab/resources.json` dans le banc de travail (paramètre `lab-resources`) : une entrée `bus-adapter` avec l’alias, les deux ports série (vous choisissez lequel est le port binaire) et l’identité USB ; les limites d’alimentation sont facultatives. La section **Configuration** de la page du plugin indique si le fichier est valide.
- Rien de plus pour un premier contact : l’agent balaie le bus et dialogue avec un composant avec les réglages habituels. Un profil de bus dans le banc de travail est facultatif ; il donne des noms aux composants et aux registres et conserve les réglages. Des exemples sont fournis avec le plugin (BME280, flash W25Q, console UART).

## Utilisation

- « Identifiez le Bus Pirate bp. » (compétence `bus-transactions`)
- « Balayez le bus I2C et dites-moi quels composants répondent. »
- « Rien ne répond : vérifiez les tensions sur les broches de l’adaptateur. »
- « Lisez le registre 0xD0 du composant à l’adresse 0x76. »
- « Écrivez un profil de bus pour le BME280 à l’adresse 0x76. » (compétence `bus-profiles`)
- « Lancez une mesure forcée sur le BME280, attendez 10 ms et lisez le résultat. »
- « Enregistrez la console UART pendant 10 secondes après l’envoi d’un retour chariot. »

Chaque étape est envoyée une seule fois : un composant qui n’acquitte pas, une réponse absente ou une valeur inattendue met fin à l’exécution, et le résultat nomme les lignes du bus qui sont à l’état bas.

## Risques et approbations

- Sûr, exécuté sans demander : liste des ports série, description d’un profil et rapports d’exécution.
- Lecture appareil : identification de l’adaptateur et lecture des tensions sur ses broches (une requête d’état ; les broches, les pull-ups et l’alimentation ne sont pas modifiés).
- Écriture appareil : le balayage, la configuration du bus, les lectures de registres (qui écrivent d’abord l’adresse du registre et peuvent effacer des indicateurs), les écritures de registres, les transferts, les séquences, la capture UART et la libération, car chacune pilote les broches de l’adaptateur sur votre circuit. Un tel appel met aussi sous tension l’alimentation de l’adaptateur pour alimenter le circuit, lorsque vous ou le profil le demandez.

En modes Demander et Modification auto, VERA demande avant chaque commande d’écriture appareil.

## Limites

- Windows x64 et Linux x64. Vérifié uniquement avec un adaptateur simulé ; pas encore sur du vrai matériel.
- Pas d’accès au terminal ni de modification du firmware ou des réglages de l’adaptateur. Les autres adaptateurs (Bus Pirate v3/v4, FT232H, CH341, Aardvark) ne sont pas pris en charge.
- Une transaction transporte au plus 512 octets dans chaque sens ; une capture UART dure au plus 300 s et conserve 1 Mio.
- Référence : https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
