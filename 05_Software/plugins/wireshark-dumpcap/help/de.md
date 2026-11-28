# Wireshark Dumpcap

Aktivieren Sie das optionale Plugin und installieren Sie Dumpcap 4.2 oder neuer. Unter Windows ist Npcap erforderlich. Unter Linux brauchen Sie Aufzeichnungsrechte für die gewählte Schnittstelle.

Bitten Sie VERA, die lokalen Schnittstellen aufzulisten. Wählen Sie eine Schnittstelle und geben Sie einen Filter mit numerischen Adressen oder Ports, eine Dauer und eine Bytegrenze an. Genehmigen Sie die angezeigte Anfrage. Legen Sie bei einem rotierenden Mitschnitt auch die Segmentgrenzen und die Zahl der aufzubewahrenden Segmente fest. Mit der Mitschnitt-ID können Sie den Status prüfen oder die Aufzeichnung stoppen. Das Manifest nennt erhaltene Segmente und bekannte Verluste. Aktivieren Sie Wireshark TShark, um einen erhaltenen Mitschnitt zu prüfen.

Ein Mitschnitt dauert höchstens 120 Sekunden und fasst höchstens 32 MiB, VERA bittet Sie um die Freigabe jedes einzelnen, und es wird nur Verkehr von und zu diesem Computer gesehen. Für jeden anderen Mitschnitt bitten Sie den Agenten um eine TShark-Aufzeichnung in eine Datei der Workbench.
