# Baze de date CAN (cantools)

Bazele de date CAN transformă traficul CAN capturat în semnale cu nume și unități. Agentul decodează fișiere de log ASC, BLF și candump cu o bază de date DBC, KCD, SYM sau ARXML și poate afișa, lista sau converti baze de date și poate genera cod sursă C din ele cu cantools. Citește doar fișiere; nu deschide niciodată o magistrală. Pentru a captura trafic, folosește pluginul can-python.

## Ce necesită

- **cantools** 45 de pe PyPI și **can-decode**, un script din plugin: ambele instalate automat de **Instalează dependențele** de pe pagina pluginului.
- O bază de date CAN și un fișier de log capturat în workbench.
- Fără pluginuri necesare, hardware sau configurare.

## Cum se folosește

- „Listează mesajele și semnalele din fixtures/board.dbc.”
- „Decodează captures/bus.asc cu fixtures/board.dbc și rezumă semnalele.” (skill-ul `can-decode`)
- „Arată doar mesajele 0x100 și 0x200 din primele 200 de cadre.”
- „Convertește board.dbc în KCD.”
- „Generează cod sursă C pentru board.dbc.”

Fiecare linie decodată arată timpul, ID-ul, mesajul și valorile semnalelor cu unități, urmate de un rezumat al cadrelor decodate pe mesaj, al cadrelor care nu au putut fi decodate și al ID-urilor pe care baza de date nu le definește. Agentul raportează ID-urile necunoscute ca trafic pe care baza de date nu îl descrie, nu ca erori, și citează captura, baza de date și momentele cadrelor din spatele fiecărei constatări. Capturile lungi sunt restrânse după ID-ul mesajului și o limită de cadre.

## Risc și aprobări

Fiecare comandă permisă de acest plugin este sigură și rulează fără să întrebe: decodarea, afișarea și listarea doar își citesc intrările; conversia și generarea de cod C își scriu fișierele de ieșire, ca alte rezultate de analiză. Nu există comenzi de citire dispozitiv, de scriere dispozitiv sau ireversibile.

Trei comenzi cantools sunt blocate: `decode` și `plot` citesc cadre de la intrarea standard, pe care VERA o închide, iar `monitor` este o vizualizare interactivă de terminal care deschide o magistrală. Agentul folosește în schimb `can-decode`.

## Limitări

- Windows x64 și Linux x64.
- O bază de date care nu trece verificările de consistență ale cantools poate fi totuși încărcată la cerere (`--no-strict`); agentul spune când a făcut asta.
- Referință: https://cantools.readthedocs.io/en/latest/
