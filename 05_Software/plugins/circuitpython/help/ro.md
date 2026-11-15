# CircuitPython

CircuitPython pune cod și biblioteci compatibile pe o placă ce rulează deja CircuitPython 9, 10 sau 11. Agentul listează unitățile CIRCUITPY și porturile seriale după identitate, inspectează firmware-ul, codul și `/lib`, pregătește biblioteci dintr-un tag fixat al bundle-ului Adafruit, implementează fișierele aprobate pe rând, fiecare verificat, și capturează rularea din consolă care urmează. Rezultatele ajung în `arduino-iot-results/<run-id>/` din workbench.

## Ce necesită

- **circuitpython-tool**: un script instalat automat de **Instalează dependențele** de pe pagina pluginului.
- O placă ce rulează CircuitPython 9, 10 sau 11, conectată prin USB, cu unitatea CIRCUITPY montată. Instalarea firmware-ului (UF2) este pasul tău; acest plugin nu o face niciodată.
- Tag-ul bundle-ului Adafruit de fixat, adică data unei versiuni a Adafruit CircuitPython Bundle (vezi https://circuitpython.org/libraries). Agentul te întreabă dacă workbenchul nu folosește deja unul.
- Fără pluginuri necesare și fără parametri de configurare.

## Cum se folosește

- „Ce plăci CircuitPython sunt conectate?” (skill-ul `circuitpython-deploy`)
- „Identifică placa de pe E: și arată-mi codul și bibliotecile de pe ea.”
- „Verifică dacă bibliotecile din /lib se potrivesc cu firmware-ul plăcii.” (skill-ul `circuitpython-libraries`)
- „Pregătește adafruit_bme280 și neopixel pentru CircuitPython 9 din bundle-ul 20261110.”
- „Implementează app/code.py cu acel set de biblioteci pe placa de pe E: și capturează 10 secunde de ieșire din consolă de pe COM7.”

Înainte de a scrie, agentul poate inspecta unitatea, astfel încât o implementare să refuze fișierele pe care le-ai modificat pe placă între timp. `settings.toml` și `secrets.py` sunt listate, dar niciodată citite.

## Risc și aprobări

- Sigur, rulează fără să întrebe: listarea unităților și a porturilor și rapoartele de rulare.
- Citire dispozitiv: identificarea plăcii, inspectarea codului și a bibliotecilor ei și citirea consolei fără a trimite nimic.
- Scriere dispozitiv: pregătirea bibliotecilor (o descărcare de pe github.com în cache-ul VERA și în workbench; nicio placă nu este atinsă), implementarea fișierelor pe unitate și o captură de consolă cu `--reload`, care oprește și repornește `code.py`. Noul cod rulează imediat după implementare și poate acționa orice este conectat la pinii plăcii; butonul Oprește nu îl oprește.
- Ireversibil: o implementare cu `--boot`, care înlocuiește `boot.py`. Poate face unitatea inaccesibilă de pe acest computer sau poate dezactiva USB-ul până când placa este pornită în safe mode. VERA îți cere să tastezi cuvântul de confirmare, cu excepția modului Bypass.

În modurile Întreabă și Editare automată, VERA cere aprobarea înaintea fiecărei comenzi de scriere dispozitiv.

## Limitări

- Windows x64 și Linux x64.
- Fără REPL, fără cod dat ca argument, fără instalare de firmware și fără actualizarea tuturor bibliotecilor.
- O unitate USB nu are tranzacții între fișiere: după o deconectare sau după apăsarea butonului Oprește, rezultatul listează fișierele confirmate.
- Referință: https://docs.circuitpython.org/en/latest/docs/workflows.html
