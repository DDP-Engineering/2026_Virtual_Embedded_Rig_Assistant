# Outils de bus (I2C, SPI, UART)

Outils de bus permet à l’agent d’exécuter des transactions I2C, SPI et UART limitées sur votre circuit au moyen d’un Bus Pirate 5 ou 6 en mode binaire BPIO2. Il identifie l’adaptateur, configure un bus à partir d’un profil, lit un registre déclaré, exécute un transfert limité ou enregistre un UART, puis laisse un état final déclaré et le relit : par défaut HiZ, avec pull-ups et alimentation coupés. La capture passive et le décodage restent du ressort du plugin sigrok. Les résultats vont dans `arduino-iot-results/<run-id>/` du banc de travail.

## Prérequis

- **bus-tool** : un script installé par **Installer les dépendances** sur la page du plugin.
- Un Bus Pirate 5 ou 6, passé une fois en BPIO2 avec sa commande de terminal `binmode`.
- `lab/resources.json` dans le banc de travail (paramètre `lab-resources`) : une entrée `bus-adapter` avec l’alias, les deux ports série (vous choisissez lequel est le port binaire), l’identité USB et des limites d’alimentation facultatives. La section **Configuration** de la page du plugin indique si le fichier est valide.
- Un profil de bus dans le banc de travail : câblage, tension logique, alimentation, réglages du bus, limites, état final, composants et registres. Des exemples sont fournis avec le plugin (BME280, flash W25Q, console UART).

## Utilisation

- « Identifiez le Bus Pirate bp. » (compétence `bus-transactions`)
- « Écrivez un profil de bus pour le BME280 à l’adresse 0x76, logique 3,3 V, alimentation externe. » (compétence `bus-profiles`)
- « Lisez le registre chip_id du BME280 et comparez-le à la valeur attendue. »
- « Lisez 16 octets de l’EEPROM à partir de 0x0010. »
- « Enregistrez la console UART pendant 10 secondes après l’envoi d’un retour chariot. »

Rien n’est relancé : un NACK, une réponse absente ou une valeur inattendue met fin à l’exécution. Il n’y a pas de balayage d’adresses ; les adresses proviennent de la datasheet ou du schéma.

## Risques et approbations

- Sûr, exécuté sans demander : liste des ports série, description d’un profil et rapports d’exécution.
- Lecture appareil : identification de l’adaptateur (une requête d’état ; les broches, les pull-ups et l’alimentation ne sont pas modifiés).
- Écriture appareil : configuration du bus, lectures de registres (qui écrivent d’abord l’adresse du registre et peuvent effacer des indicateurs), transferts, capture UART et libération, car chacune pilote les broches de l’adaptateur sur votre circuit.
- Irréversible : tout appel avec `--power`, qui met sous tension l’alimentation de l’adaptateur et alimente le circuit qui y est câblé. VERA vous demande de taper le mot de confirmation, sauf en mode Contournement.

En modes Demander et Modification auto, VERA demande avant chaque commande d’écriture appareil.

## Limites

- Windows x64 et Linux x64. Vérifié uniquement avec un adaptateur simulé ; pas encore sur du vrai matériel.
- Pas d’accès au terminal ni de modification du firmware ou des réglages de l’adaptateur. Les autres adaptateurs (Bus Pirate v3/v4, FT232H, CH341, Aardvark) ne sont pas pris en charge.
- Après un état final non confirmé, VERA refuse les opérations de bus jusqu’à ce qu’une libération le confirme.
- Référence : https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/
