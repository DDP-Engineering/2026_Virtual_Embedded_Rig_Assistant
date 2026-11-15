# Proiecte PlatformIO

Acest plugin îi permite agentului să inspecteze, să compileze, să testeze și să încarce proiecte PlatformIO existente prin operații verificate. Agentul scrie o cerere explicită care numește folderul proiectului, mediul, un folder PlatformIO core și propriul lui folder de build. Scripturile extra, scripturile bibliotecilor și runner-ele de test personalizate sunt refuzate dacă nu le aprobi după hash, iar build-urile păstrează fișierele de firmware cu hash-uri, versiuni și loguri. Agentul nu rulează niciodată `pio` direct.

## Ce necesită

- **Două helpere Python** cu un PlatformIO Core 6.2.0 fixat, pe care VERA le instalează singură cu **Instalează dependențele**. Propriul tău `pio` nu este folosit.
- **Un folder PlatformIO core**: orice folder gol pe care îl alegi. Un pas de rețea aprobat separat îl umple cu pachete; build-urile și testele rulează apoi offline.
- **Un compilator pentru gazdă** pentru mediile `native`, pe care îl instalezi singur: GCC pe Linux, un GCC MinGW-w64 pe Windows.
- Pentru încărcări: un probe ST-Link și registrul de laborator `lab/resources.json` în workbench, care declară probe-ul prin alias (opțional; nu este necesar pentru build-uri și testele native). Secțiunea **Configurare** de pe pagina pluginului arată dacă este prezent și valid.
- Nu sunt necesare alte pluginuri.

## Cum se folosește

Agentul folosește skill-ul `platformio-projects`. Te întreabă ce mediu să folosească și nu editează niciodată platformio.ini sau codul tău ca să treacă un build.

- „Inspectează firmware/board demo și arată opțiunile efective ale mediului disco.”
- „Pregătește pachetele pentru mediul disco în D:/pio-core.”
- „Compilează mediul disco și raportează utilizarea memoriei.”
- „Rulează testele Unity native test_lines pe acest computer.”
- „Încarcă ultimul build pe placă prin probe-ul stlink1; firmware-ul nu acționează niciun element de execuție.”

## Risc și aprobări

- **Sigur** (rulează fără să întrebe): inspectarea proiectului și a mediilor, raportarea artefactelor și evaluarea rulărilor de test. Acestea nu pornesc niciun build, niciun cod de proiect și niciun acces la rețea.
- **Scriere dispozitiv** (întreabă în modurile **Întreabă** și **Editare automată**): compilarea și testarea, pentru că se rulează cod de proiect pe computerul tău (o aprobare nu este un sandbox); curățarea folderelor de build ale VERA; pregătirea pachetelor, singurul pas de rețea; și încărcarea, care suprascrie flash-ul țintei.
- **Ireversibil** (întreabă, iar tu tastezi cuvântul de confirmare afișat pe card): încărcarea unui firmware care acționează elemente de execuție odată ce pornește. În **Bypass — acces complet** aceasta rulează fără să întrebe.

În timpul unei încărcări, VERA rezervă probe-ul.

## Limitări

- Windows x64 și Linux x64. Verificat pe Windows x64 cu platforma ststm32 (disco_f407vg) și platforma native; încărcările pe plăci reale și Ubuntu nativ nu sunt încă verificate.
- Încărcările suportă doar protocolul `stlink`.
- Testele pentru dispozitiv sunt doar compilate aici; verdictul lor necesită o rulare Renode sau HIL a aceluiași ELF.
