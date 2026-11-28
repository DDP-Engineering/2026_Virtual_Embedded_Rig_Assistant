# Wireshark Dumpcap

Aktivieren Sie das optionale Plugin und installieren Sie Dumpcap 4.2 oder neuer. Unter Windows ist Npcap erforderlich. Unter Linux brauchen Sie Aufzeichnungsrechte für die gewählte Schnittstelle.

Bitten Sie VERA aufzuzeichnen, was ein Board an einer Netzwerkschnittstelle dieses Computers sendet und empfängt. Sie listet die Schnittstellen auf und kann einige Sekunden lang zählen, wie viele Pakete jede sieht, um die Schnittstelle des Boards zu finden. Nennen Sie die Schnittstelle; ein Aufzeichnungsfilter, eine Dauer (standardmäßig 30 Sekunden, höchstens eine Stunde) und eine Größengrenze sind optional. Ein Mitschnitt von mehr als einer Minute läuft im Hintergrund: VERA kann ihn starten, einen Test ausführen oder das Board neu starten und ihn dann stoppen. Für ein seltenes Ereignis bitten Sie um einen rotierenden Mitschnitt, der die neuesten Segmente behält. Das Ergebnis nennt, was aufbewahrt wurde und was verloren ging. Aktivieren Sie Wireshark TShark, um einen erhaltenen Mitschnitt zu prüfen.

Ein Mitschnitt ist ein Gerätelesezugriff: VERA fragt im Modus Nachfragen und führt ihn in Auto-Edit und Bypass selbstständig aus. USB- und Sniffer-Schnittstellen, die Wireshark über extcap erreicht, werden mit TShark aufgezeichnet.
