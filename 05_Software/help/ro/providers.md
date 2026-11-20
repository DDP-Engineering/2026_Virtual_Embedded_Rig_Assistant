# Furnizori și modele

Un furnizor îi oferă lui VERA acces la un model de limbaj. Ai nevoie de cel puțin unul. Configurezi furnizorii în **Setări** → **Furnizori**, care are două părți: **Abonamente** și **Conexiuni API / locale**.

Sub **Adaugă conexiune**, folosește **Caută furnizori** pentru a găsi un furnizor după nume.

## Abonament ChatGPT

1. La **Abonament ChatGPT**, selectează **Autentificare cu ChatGPT**. Browserul sistemului deschide pagina de autentificare.
2. Autentifică-te acolo. VERA afișează **Autentificat cu ChatGPT** când procesul s-a încheiat.

Tokenul se reînnoiește automat. **Deconectare** îl elimină.

- Dacă autentificarea nu se încheie, lipește adresa finală din browser în **Lipește URL-ul final de redirecționare dacă autentificarea nu se încheie** și selectează **Finalizează autentificarea**.
- Autentificarea expiră după 10 minute.
- Dacă portul 1455 este ocupat, de obicei o autentificare din Codex CLI este încă deschisă. Anuleaz-o și încearcă din nou.

## API OpenAI

1. La **Conexiuni API / locale**, selectează **Adaugă o conexiune** și alege **API OpenAI** ca **Furnizor**.
2. Introdu **Cheie API OpenAI** și, opțional, **Model OpenAI**.
3. Selectează **Salvează**.

## LM Studio

1. Pornește serverul LM Studio și încarcă un model.
2. **Adaugă o conexiune**, **Furnizor** LM Studio. Adresa `http://localhost:1234` este completată automat.
3. Selectează **Testează conexiunea**. VERA citește modelele de conversație ale serverului; modelele de embedding sunt omise.
4. Pentru fiecare model, verifică limita de context afișată de VERA. Dacă serverul nu raportează niciuna, seteaz-o tu. Valorile opționale **Raționament** și **Temperatură** rămân pe **Implicit la furnizor** dacă nu le setezi.
5. Selectează **Salvează**.

Pentru LM Studio, cheia API este opțională.

## Ollama și alte endpointuri compatibile

1. **Adaugă o conexiune**, **Furnizor** Ollama sau **Alt furnizor compatibil**. Pentru Ollama, **URL de bază** `http://localhost:11434/v1` este completat automat.
2. Introdu **Numele endpoint-ului**, **URL de bază** (o adresă `http` sau `https` care se termină în `/v1`), numele de la **Model** așa cum îl cunoaște serverul, **Fereastră de context (tokenuri)** și **Ieșire maximă (tokenuri)**.
3. Introdu **Cheia API a endpoint-ului** dacă serverul are nevoie de una sau lasă câmpul gol.
4. Selectează **Salvează**.

Ia fereastra de context din documentația modelului sau din setările serverului. O valoare prea mare duce la erori de la server; una prea mică face ca VERA să rezume istoricul mai devreme decât este necesar.

## Suport pentru imagini

Caseta de mesaj afișează un avertisment când modelul curent primește doar căile imaginilor.

VERA citește suportul pentru imagini din cataloagele de modele ChatGPT și API OpenAI. Pentru LM Studio, Ollama sau alt endpoint compatibil, alege ori introdu modelul. Dacă acceptă imagini, activează **Acceptă imagini** și alege **Salvează**. Opțiunea este inițial dezactivată pentru fiecare model.

O imagine trimisă unui model părăsește calculatorul dacă furnizorul rulează la distanță. Mascarea textului se aplică și căilor imaginilor, în funcție de setări. Modelul primește direct pixelii imaginii.

## Testează o conexiune

**Testează** rulează patru verificări: **Conectivitate**, **Autentificare și model**, **Apelare instrumente** și **Streaming**. Fiecare afișează **Reușit**, **Eșuat** sau **Omis**. Agentul folosește apeluri de instrumente pentru a căuta în documente, a citi și modifica fișiere și a rula programe, așa că alege un model care trece de **Apelare instrumente**.

## Chei și stocare securizată

Cheile sunt stocate criptat cu stocarea securizată a sistemului de operare. Când aceasta nu este disponibilă, VERA îți cere să alegi: **Folosește doar pentru această rulare** păstrează cheia în memorie până la închiderea VERA, **Salvează fără criptare sigură** o salvează într-un fișier pe care îl poate citi oricine are acces la contul tău. Pentru a înlocui o cheie, introdu una nouă; pentru a o elimina, folosește **Elimină cheia salvată**. **Elimină** șterge o conexiune.

## Alege un model

- Pentru o sesiune: alege **Model** lângă caseta de mesaj.
- Pentru un workbench: **Editează workbench-ul** → **Agent și chat** → **Model implicit**, scris ca `provider/model`. Lasă câmpul gol pentru a folosi valoarea implicită a aplicației.

Alegerea din sesiune are prioritate față de valoarea implicită a workbench-ului, iar valoarea implicită a workbench-ului față de cea a aplicației.

Lista de modele afișează furnizorul, limita de context, tipurile de intrare și informațiile disponibile despre instrumente și raționare. **Instrumente neverificate** indică faptul că apelarea instrumentelor nu a fost confirmată pentru acel model.

## Erori frecvente

| Mesaj | Ce faci |
|---|---|
| **Autentificare eșuată. Verifică datele salvate în setările furnizorilor.** | Introdu din nou cheia sau autentifică-te din nou |
| **Limita de cereri a furnizorului a fost atinsă.** | Așteaptă timpul afișat, apoi reîncearcă |
| **Furnizorul a respins dimensiunea contextului.** | Scurtează intrarea sau corectează **Fereastră de context (tokenuri)** |
| **Nu se poate accesa …** | Pornește serverul local sau verifică rețeaua și **URL de bază** |

Vezi și [Depanare](troubleshooting.md).
