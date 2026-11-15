# Profilage de consommation

Ce plugin permet à l’agent de mesurer le courant, la tension, la puissance, l’énergie et la charge d’une carte avec un Joulescope JS220 et d’analyser les captures hors ligne. Une capture associe les données au build du firmware et enregistre des marqueurs GPI pour les événements ; les trous et les dépassements ne deviennent jamais des zéros. L’analyse fournit le courant moyen, minimal et maximal, l’énergie et la charge, le temps passé en veille et en activité, l’énergie par événement, une comparaison de firmwares A/B et un intervalle d’autonomie de batterie avec ses hypothèses. Les résultats vont dans `embedded-lab-results/`.

## Prérequis

- **power-profile** (avec pyjoulescope_driver 2.5.5) et **power-analyze**, des scripts Python que VERA installe lui-même avec **Installer les dépendances**.
- **Un Joulescope JS220** par lequel passe l’alimentation de la carte. L’accès USB nécessite WinUSB sous Windows ou la règle udev du fabricant sous Linux, que vous configurez vous-même.
- **Le registre du banc** `lab/resources.json` dans le banc de travail (obligatoire), qui déclare l’appareil de mesure comme moniteur d’alimentation, par exemple avec l’alias `js1`. La section **Configuration** de la page du plugin indique si le fichier est présent et valide.
- Aucun autre plugin. Un verdict de firmware A/B utilise lab-validate du plugin lab-validation.

## Utilisation

L’agent utilise les compétences `power-measurement` et `energy-analysis`. Il demande comment la carte est câblée, quels GPIO arrivent aux entrées GPI de l’appareil de mesure, et la tension d’alimentation.

- « Identifiez l’appareil de mesure js1 et vérifiez le pilote et l’accès USB. »
- « Capturez 20 secondes à 100 kHz avec le marqueur 0, le firmware build/app.elf, la carte sensor-node rév. B à 3,3 V. »
- « Mesurez l’énergie et la charge de cette capture de 2 s à 12 s. »
- « Découpez la capture en réveils selon le marqueur 0 et donnez l’énergie par réveil et le courant de veille. »
- « Comparez les firmwares A et B et estimez l’autonomie de la batterie avec battery.json. »

## Risques et approbations

- **Sûr** (exécuté sans demander) : vérification des prérequis du pilote et toutes les étapes d’analyse hors ligne.
- **Lecture appareil** (demande en mode **Demander**, exécuté directement en mode **Modification auto**) : liste des appareils de mesure connectés et identification de l’appareil ; rien n’est modifié.
- **Écriture appareil** (demande en modes **Demander** et **Modification auto**) : une capture, car elle règle la fréquence d’échantillonnage et la gamme de l’appareil de mesure, ce qui modifie la chute de tension en série avec votre carte (les réglages précédents sont rétablis ensuite) ; et le nettoyage de VERA après une capture interrompue.

Le plugin ne commute jamais le chemin du courant de la carte, ne pilote jamais les sorties de l’appareil de mesure et ne met jamais à jour son firmware.

## Limites

- Windows x64 et Linux x64.
- Le profil du JS220 n’a pas encore été vérifié avec un vrai appareil.
- Une capture contient au plus 1 000 000 d’échantillons.
- Si le chemin du courant de l’appareil de mesure est coupé, les captures sont refusées.
- Non fournis : console de l’appareil de mesure, contrôle du chemin d’alimentation, fichiers JLS et autres appareils comme le PPK2 ou l’Otii.
