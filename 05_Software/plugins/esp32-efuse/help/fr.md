# eFuses ESP32 et sécurité des images

Le plugin eFuses ESP32 et sécurité des images permet à l’agent d’examiner les eFuses d’une puce Espressif et, uniquement si vous le demandez explicitement, d’effectuer une modification permanente d’eFuse à la fois. Il lit les résumés et les valeurs brutes des eFuses avec espefuse, et prépare localement des clés de secure boot, des signatures, des empreintes et des images chiffrées avec espsecure. Les bits d’eFuse sont programmables une seule fois : une programmation ne peut jamais être annulée et peut rendre la puce inutilisable. Activez-le pour un banc de travail uniquement quand c’est nécessaire ; dans le pack ESP32, son groupe **Security (irreversible)** est désactivé par défaut.

## Prérequis

- **espefuse** et **espsecure** du paquet esptool 5 sur PyPI, installés automatiquement par **Installer les dépendances** sur la page du plugin. Rien n’est programmé lors de l’installation.
- Une carte de la famille ESP32 sur un port série pour les lectures et les programmations. Les eFuses virtuels (`--virt`) ne nécessitent aucune puce.
- Aucun plugin requis et aucun paramètre de configuration.

## Utilisation

- « Affichez le résumé des eFuses de l’ESP32-S3 sur COM5. » (compétence `esp32-efuse-review`)
- « Le secure boot ou le chiffrement de la flash est-il activé sur cette puce ? »
- « Expliquez ce que ferait la programmation de JTAG_DISABLE sur cet ESP32, et rédigez un plan pour cela. »
- « Générez une clé de signature secure boot et signez build/app.bin. »
- « Essayez d’abord la programmation de JTAG_DISABLE sur des eFuses virtuels. »

Une question sur le secure boot, un examen ou l’activation du plugin ne valent jamais demande de programmation. Avant toute programmation, l’agent lit le résumé actuel, explique le champ exact, sa valeur actuelle et la valeur visée, et comment une mauvaise valeur pourrait rendre cette puce inutilisable, puis enregistre un plan écrit comme artefact de session pour que vous l’examiniez. Il ne regroupe jamais plusieurs programmations dans une seule commande, ne relance jamais une programmation qui a échoué et n’ajoute jamais `--force`. Les clés privées restent hors du chat et des artefacts.

## Risques et approbations

- Sûr, exécuté sans demander : l’aide et les opérations espsecure sur des fichiers locaux de clés et d’images. Sûr ne décrit que le risque matériel : espsecure peut écraser des fichiers de sortie, et `sign-data` modifie son fichier d’entrée quand aucune sortie n’est indiquée.
- Lecture appareil : résumé, vidage, contrôles d’erreurs, MAC personnalisée et informations ADC. La connexion réinitialise la puce dans son bootloader.
- Irréversible : toute commande `burn-*`, la protection en écriture et en lecture, et le réglage de la tension de la flash. En modes Demander et Modification auto, VERA vous demande de taper le mot de la commande, par exemple `burn-efuse`. En mode Contournement, ces commandes s’exécutent sans demander : utilisez donc le mode Contournement avec prudence quand ce plugin est activé.
- Bloqué : les opérations espsecure avec un HSM externe.

## Limites

- Windows x64 et Linux x64.
- Toutes les programmations testées ont utilisé des eFuses virtuels ; aucune programmation physique n’a été testée.
- Une puce dont le schéma de codage exige de programmer plusieurs champs ensemble n’est pas prise en charge ; l’agent s’arrête et explique.
- Références : https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/index.html et https://docs.espressif.com/projects/esptool/en/latest/esp32/espsecure/index.html
