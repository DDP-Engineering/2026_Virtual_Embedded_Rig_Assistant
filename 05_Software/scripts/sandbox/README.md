# Șablonul Windows Sandbox

[VERA.wsb](VERA.wsb) este o configurație exemplu pentru Windows Sandbox,
folosită la verificări manuale ale pachetelor VERA într-un mediu izolat.
Nu face parte din aplicație și nu pornește la `npm run dev` sau la testele uzuale.

## Ce configurează

- Dezactivează rețeaua sandbox-ului și redirecționarea clipboard-ului.
- Mapează `D:\VERA-release-input` de pe host în `C:\VERA-input` în guest,
  cu acces numai pentru citire.
- Mapează `D:\VERA-release-evidence` de pe host în `C:\VERA-evidence` în guest,
  cu acces de scriere pentru rezultatele verificării.

Aceste căi sunt exemple din șablon și trebuie înlocuite cu directoarele proprii
într-o copie a fișierului. Input-ul poate conține artefactul exact de verificat,
raportul aferent și o copie a demo-ului fictiv. Output-ul trebuie să fie un director
nou destinat rulării. Fișierele scrise în `C:\VERA-evidence` rămân pe host în
directorul mapat, inclusiv după închiderea sandbox-ului.

## Utilizare manuală

1. Pe un Windows care are Windows Sandbox disponibil, pregătește directoarele de
   input/output și o copie locală a `VERA.wsb`.
2. În copia locală, înlocuiește cele două valori `HostFolder` cu căile reale.
3. Deschide copia `.wsb` pentru a porni sandbox-ul.
4. În guest, execută procedura de verificare aleasă și salvează rezultatele în
   `C:\VERA-evidence`.

Acest șablon nu conține un `LogonCommand`: nu instalează și nu testează automat
VERA la pornire. Izolarea de rețea configurată nu reprezintă singură dovada că
aplicația funcționează offline; trebuie rulat și verificat scenariul relevant.

## Diferența față de configurația generată

[`../probe-windows-sandbox.ps1`](../probe-windows-sandbox.ps1) generează un alt
fișier, `VERA-offline.wsb`, din căile artefactului și ale directorului de rezultate.
Calculează hash-uri, copiază proba offline și adaugă un script de pornire automată
în guest. Cu `-Launch`, pornește și Windows Sandbox. Acesta este fluxul pentru
ZIP-ul **instrumentat**, diferit de șablonul manual de aici.

Validarea unui pachet release prin fluxurile obișnuite ale aplicației este descrisă
în [release-package-smoke.md](../../../06_SoftwareDocu/release-package-smoke.md),
inclusiv pașii Windows pentru capturarea traficului. Probele instrumentate și
verificările release au rezultate și scopuri distincte.

Vezi și [scripts/README.md](../README.md) pentru inventarul scripturilor.
