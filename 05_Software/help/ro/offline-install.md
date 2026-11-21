# Instalare offline

VERA poate fi instalat și folosit pe un calculator de laborator fără rețea. Programul de instalare conține tot ce are nevoie aplicația: modelul local de indexare, instalatorul de instrumente Python și catalogul oficial de pluginuri. Programele rulate de pluginuri sunt livrate separat, într-un kit de dependențe offline. Modelele AI au în continuare nevoie de un furnizor: pe un calculator fără rețea, folosește un server local precum LM Studio sau Ollama (vezi [Furnizori și modele](providers.md)).

## Folderul de livrare

O livrare VERA este un folder pentru fiecare versiune, `vera-<version>/`:

| Folder | Conținut |
|---|---|
| `vera-windows-x64/` | `VERA-<v>-win-x64.exe` (program de instalare), `VERA-<v>-win-x64.zip` (portabil), `SHA256SUMS` |
| `vera-linux-x64/` | `VERA-<v>-linux-*.AppImage`, `VERA-<v>-linux-*.deb`, `SHA256SUMS` |
| `plugins/` | Câte un `<id>-<version>.zip` pentru fiecare plugin, indexurile catalogului, `vera-plugins-<version>.zip` cu întregul catalog, `SHA256SUMS` |
| `plugin-deps/` | `vera-plugin-deps-<version>-windows-x64.zip` și `…-linux-x64.zip`, `SHA256SUMS` |
| `delivery.json` | Ce s-a construit: versiuni, fișiere, dimensiuni și SHA-256 |

Copiază folderul platformei tale și `plugin-deps/` dacă vrei să folosești programele pluginurilor. `plugins/` este necesar doar pentru pluginurile mai noi decât programul tău de instalare VERA. Kitul de dependențe are aproximativ 1 GB pentru fiecare platformă.

## 1. Verifică fișierele

Compară fiecare fișier cu linia sa din `SHA256SUMS`:

- Linux: rulează `sha256sum -c SHA256SUMS` în fiecare folder.
- Windows (PowerShell): rulează `Get-FileHash <file> -Algorithm SHA256` și compară hash-ul cu linia din `SHA256SUMS`.

Nu instala un fișier al cărui hash diferă; copiază-l din nou.

## 2. Instalează VERA

- Programul de instalare pentru Windows: rulează `VERA-<v>-win-x64.exe`. Instalează pentru utilizatorul tău și nu necesită drepturi de administrator.
- Versiunea portabilă pentru Windows: extrage `VERA-<v>-win-x64.zip` și pornește `vera.exe`. Setările și datele sale rămân în folderul `data` de lângă el.
- Linux: `sudo apt install ./VERA-<v>-linux-amd64.deb` sau fă AppImage-ul executabil cu `chmod +x` și rulează-l.
- Cu rețea, adaugă depozitul apt VERA, ca `sudo apt upgrade` să actualizeze și o instalare `.deb`: vezi [Setări](settings.md), **Actualizări**.

## 3. Instalează pluginuri

Pagina **Pluginuri** listează pluginurile oficiale ale versiunii tale de VERA din catalogul inclus în programul de instalare; instalează-le de acolo ca de obicei (vezi [Pluginuri](plugins.md)). Pentru un plugin mai nou din livrare, selectează **Instalează din zip…** și alege `plugins/<id>-<version>.zip`.

## 4. Pregătește programele pluginurilor pentru lucrul offline

1. Extrage `vera-plugin-deps-<version>-<platform>.zip` într-un folder local. Folderul extras conține `kit.json`.
2. Închide VERA.
3. Deschide fișierul `settings.json` al VERA într-un editor de text. Se află în `%APPDATA%\VERA\` pe Windows, în `~/.config/VERA/` pe Linux sau în folderul `data` al versiunii portabile.
4. Adaugă setarea `plugins.kit` cu calea absolută a folderului extras, de exemplu:

   ```json
   "plugins": { "kit": "D:\\vera-plugin-deps-<version>-windows-x64" }
   ```

   Dacă `settings.json` are deja o intrare `plugins`, adaugă `kit` în interiorul ei. În JSON, scrie fiecare backslash de două ori.
5. Pornește VERA, deschide pluginul pe pagina **Pluginuri** și selectează **Instalează dependențele**.

VERA verifică fiecare fișier din kit după SHA-256 din manifestul pluginului și refuză un fișier modificat. Pentru a instala din nou din rețea, elimină `plugins.kit`.

Pentru a instala un singur program dintr-o arhivă pe care ai copiat-o tu, folosește în schimb **Instalează din arhiva dependenței…** pe cardul pluginului.

## Programele producătorilor

Programele producătorilor, cum ar fi KiCad, LTspice sau STM32CubeProgrammer, nu fac niciodată parte din kit. Fișierul `README.md` al kitului listează fiecare dintre ele cu pagina sa de descărcare. Instalează-le cu programul de instalare al producătorului, apoi selectează **Verifică dependențele** pe plugin.
