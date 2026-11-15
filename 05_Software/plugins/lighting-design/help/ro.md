# Proiectare iluminat

Proiectarea iluminatului îi oferă agentului instrumentul integrat `lighting_design` al VERA pentru iluminatul interior al unei încăperi dreptunghiulare. Nivelul preliminar citește fotometrie IES LM-63 sau EULUMDAT și dă o estimare prin metoda fluxului util cu factori de utilizare citați, corpurile de iluminat necesare, puterea instalată și componenta directă pe grila de calcul, cu diagnostice pentru o unitate de lungime greșită, scară, orientare sau fotometrie. Nivelul de verificare controlează un raport DIALux evo pe care îl exporți pentru aceeași încăpere și abia apoi dă verdicte pentru iluminarea menținută, uniformitate și orbire. Fiecare rezultat își declară sursele, unitățile, ipotezele și limitele. VERA nu scrie niciun fișier DIALux și nu rulează DIALux.

## Ce necesită

- Fără programe: pluginul aduce un skill, iar agentul folosește instrumentul integrat al VERA, oferit doar cât timp pluginul este activat. Nu e nimic de instalat.
- Un proiect de iluminat pe care agentul îl scrie împreună cu tine: unitatea de lungime declarată, încăperea, reflectanțele, planul de calcul, factorul de mentenanță cu sursa lui, tipurile de corpuri, pozițiile și orientările, precum și cerințele introduse de tine din standardul aplicabil, cu sursa lor.
- Fișierele `.ies` sau `.ldt` ale producătorului, nemodificate, și factorii de utilizare din tabelul producătorului. Agentul întreabă de unde provin fișierele și nu descarcă niciunul fără acordul tău.
- Pentru verificare: DIALux evo pe Windows, unde construiești aceeași încăpere din valorile proiectului și aceleași fișiere de fotometrie, calculezi și exporți raportul.

## Cum se folosește

- „Scrie un proiect de iluminat pentru acest birou de 8 pe 6 m din aceste fișiere IES și verifică rezultatul preliminar.” (skill-ul `lighting-design`)
- „Câte dintre aceste corpuri de iluminat îmi trebuie pentru 500 lx menținuți?”
- „De ce pare atât de mică componenta directă? Verifică diagnosticele pentru unitate, înclinare și rotație.”
- „Compară fluxul și puterea din catalog cu ce spune fișierul de fotometrie.”
- „Condu-mă prin pașii din DIALux evo ca să refac această încăpere.”
- „Verifică raportul DIALux exportat față de proiect, apoi dă verdictele pentru uniformitate și orbire.”

Fișierele de proiect, de fotometrie și de raport ajung în `electrical-automation-lighting/` și `electrical-automation-photometry/`; fiecare rezultat ajunge în `electrical-automation-results/<run-id>/` și nu suprascrie niciodată unul anterior.

## Risc și aprobări

Instrumentul este de scriere: nu este oferit în sesiunile Doar citire, iar VERA întreabă înainte să salveze un rezultat sau un fișier de proiect, ca la orice scriere de fișier. Nu modifică alt fișier și nu pornește niciun program. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64 și WSL2; încă nerulat pe Ubuntu x64 nativ.
- Nivelul preliminar este o estimare, niciodată un verdict fotometric detaliat: iluminarea menținută, uniformitatea și UGR rămân neevaluate până când un raport de motor care se potrivește este verificat. VERA nu calculează ea însăși uniformitatea sau UGR.
- Datele lipsă rămân necunoscute și nu trec niciodată. Un raport care nu se potrivește cu proiectul este respins; modelul se corectează în DIALux, niciodată înregistrarea.
- Iluminatul de siguranță și cel exterior nu sunt acceptate în această versiune. Fotometria trebuie să fie IES LM-63 de tip C sau EULUMDAT; alte fișiere sunt refuzate, cu motivul.
