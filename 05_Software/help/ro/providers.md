# Furnizori și modele

Un furnizor îi oferă lui VERA acces la un model de limbaj. Ai nevoie de cel puțin unul. Configurezi furnizorii în **Setări** → **Furnizori**. Selectează **Adaugă furnizor** și alege furnizorul din lista **Furnizor**. Lista include **Abonament ChatGPT**.

Fiecare furnizor conectat apare ca un card cu **Editează**, **Testează** și **Elimină**. Cardul abonamentului ChatGPT are în schimb **Deconectare**. Cardul listează **Modele** ca bife. La mai mult de zece modele, folosește **Filtrează modelele** și paginile. VERA oferă doar modelele bifate în selectorul de modele din chat și în lista modelelor implicite din workbench. Un furnizor nou oferă doar modelul ales la conectare; bifează mai multe pe cardul lui. Un furnizor configurat mai demult oferă toate modelele sale până când schimbi bifele. Selectează **Salvează** în dreapta sus ca să păstrezi bifele. **Anulează** renunță la ele.

## Abonament ChatGPT

1. Selectează **Adaugă furnizor**, alege **Abonament ChatGPT** ca **Furnizor** și selectează **Autentificare cu ChatGPT**. Browserul sistemului deschide pagina de autentificare.
2. Autentifică-te acolo. VERA afișează **Autentificat cu ChatGPT** când procesul s-a încheiat.

Tokenul se reînnoiește automat. **Deconectare** îl elimină.

- Dacă autentificarea nu se încheie, lipește adresa finală din browser în **Lipește URL-ul final de redirecționare dacă autentificarea nu se încheie** și selectează **Finalizează autentificarea**.
- Autentificarea expiră după 10 minute.
- Dacă portul 1455 este ocupat, de obicei o autentificare din Codex CLI este încă deschisă. Anuleaz-o și încearcă din nou.

## API OpenAI

1. Selectează **Adaugă furnizor** și alege **API OpenAI** ca **Furnizor**.
2. Introdu **Cheie API OpenAI** și, opțional, **Model OpenAI**.
3. Selectează **Salvează**.

## OpenCode Console și OpenCode Go

1. Creează o cheie API pentru spațiul de lucru în OpenCode Console. Acordă-i permisiuni de citire a modelelor și de inferență.
2. În VERA, selectează **Adaugă furnizor**, apoi alege **OpenCode Console** pentru plata în funcție de consum sau **OpenCode Go** pentru abonamentul Go.
3. Introdu cheia și selectează **Descoperă modele**. Alege un model din lista planului sau introdu ID-ul exact și limitele pentru configurare manuală.
4. Salvează și testează conexiunea. Alege modelul pentru sesiune sau pentru workbench.

VERA stochează separat cheia fiecărei conexiuni. Poți folosi aceeași cheie pentru ambele conexiuni dacă spațiul de lucru are credit și un abonament Go. Modelele gratuite Console sunt disponibile numai în OpenCode. Verifică limitele spațiului de lucru și opțiunea Go Extra Usage pentru a afla când OpenCode poate folosi soldul.

Catalogul indică funcțiile modelelor. Folosește **Testează** pentru a verifica apelurile de instrumente și răspunsurile în flux pentru modelul selectat.

Consultă [configurarea OpenCode](https://opencode.ai/docs/console/harnesses) și [ghidul planului Go](https://opencode.ai/docs/console/go/).

## QwenCloud Standard și QwenCloud Token Plan

1. Selectează **Adaugă furnizor** și alege **QwenCloud Standard** pentru o cheie API din Singapore cu plată în funcție de consum sau **QwenCloud Token Plan** pentru cheia dedicată planului (`sk-sp-`). VERA completează URL-ul de bază al planului selectat.
2. Introdu cheia corespunzătoare și selectează **Descoperă modele**. Dacă lista nu este disponibilă, introdu ID-ul exact al modelului pentru regiunea sau planul tău. De exemplu, `qwen3.8-flash` acceptă text și imagini, apeluri de instrumente și activarea sau dezactivarea raționamentului. `qwen3.7-max` acceptă text, apeluri de instrumente și aceeași opțiune de raționament. Capabilitățile altor modele pot fi neverificate.
3. Selectează **Salvează**, apoi **Testează**. Dacă verificarea disponibilității catalogului este omisă, pasul de autentificare și model verifică cheia și modelul printr-un apel de chat. Alege modelul pentru sesiune sau workbench.

Folosește Token Plan pentru sesiuni interactive ale agentului, conform [politicii de utilizare](https://docs.qwencloud.com/token-plan/token-plan-permissions-and-usage). Dacă se epuizează creditele, consultă utilizarea și cota planului. Dacă ai atins limita de frecvență a cererilor, așteaptă înainte să încerci din nou.

Consultă [cheile API QwenCloud](https://docs.qwencloud.com/developer-guides/administration/api-keys) și [modelele și erorile Token Plan](https://docs.qwencloud.com/token-plan/token-plan-faq).

## DeepSeek, Moonshot AI și Kimi For Coding

1. Selectează **Adaugă furnizor** și alege **DeepSeek** pentru o cheie API DeepSeek, **Moonshot AI** pentru o cheie de pe platforma internațională Kimi API sau **Kimi For Coding** pentru o cheie din consola Kimi Code. VERA completează adresa de bază a serviciului.
2. Introdu cheia serviciului. Pentru DeepSeek și Moonshot AI, alege **Descoperă modele** sau introdu ID-ul exact al modelului. Pentru Kimi For Coding, introdu un ID precum `kimi-for-coding` sau `k3-256k`, în funcție de abonament.
3. Alege **Salvează**, apoi **Testează**. Pentru Kimi For Coding, verificarea accesibilității este omisă, iar verificarea autentificării și a modelului trimite o cerere către model.

Folosește ID-ul exact al modelului Kimi For Coding. Dacă ID-ul este greșit, Kimi Code poate răspunde cu un alt model. Un test reușit lasă capabilitățile ID-urilor Kimi neverificate.

DeepSeek Flash, Kimi K3 de la Moonshot AI și cele două modele Kimi Code din exemple acceptă text și imagini în VERA. DeepSeek V4 Pro acceptă text. Capabilitățile altor modele pot fi neverificate.

Vezi [limitele modelelor DeepSeek](https://api-docs.deepseek.com/api/list-models/), [ghidul Moonshot Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) și [configurarea modelelor Kimi Code](https://www.kimi.com/code/docs/en/kimi-code/models).

## MiniMax și Z.AI

1. Selectează **Adaugă furnizor** și alege **MiniMax API** pentru o cheie cu plată în funcție de consum (`sk-api-`) sau **MiniMax M Plan** pentru o cheie de abonament MiniMax (`sk-cp-`). Ambele folosesc serviciul internațional Messages.
2. Alege **Z.AI API** pentru o cheie API standard. **Z.AI GLM Coding Plan** folosește adresa internațională dedicată planului. Folosește o cheie Personal Coding Plan sau Team Plan numai dacă Z.AI a autorizat accesul din VERA. Z.AI limitează utilizarea planului la instrumentele acceptate, iar VERA nu apare în lista publicată. Verifică tipul cheii în cont, deoarece unele chei funcționează la mai multe adrese, iar facturarea depinde de cheie și de adresă.
3. Alege un model sugerat sau introdu ID-ul exact activat pentru contul tău. Selectează **Salvează**, apoi **Testează**. Verificarea cheii și a modelului trimite cereri de inferență, care pot consuma din cotă. Alege modelul salvat pentru sesiune sau workbench.

`MiniMax-M3.1-Flash` și `glm-5.3-flash` acceptă text și imagini, apeluri de instrumente și niveluri de raționament. În MiniMax API, `MiniMax-M3` acceptă text și imagini și permite activarea sau dezactivarea raționamentului. `glm-5.3` acceptă text, apeluri de instrumente și niveluri de raționament. Capabilitățile altor ID-uri introduse manual rămân neverificate.

Consultă [configurarea cheilor MiniMax](https://platform.minimax.io/docs/guides/quickstart-preparation), [gestionarea cheilor Z.AI](https://docs.z.ai/devpack/notice/api-key-management) și [instrumentele acceptate de Z.AI](https://docs.z.ai/devpack/tool/others#supported-tools).

## Alibaba Cloud și Xiaomi MiMo

1. Alege **Alibaba Cloud Model Studio** pentru plata în funcție de consum. Selectează regiunea din consola Model Studio, copiază **ID-ul spațiului de lucru** (începe cu `llm-`) și introdu o cheie pentru acel spațiu.
2. Alege **Alibaba Cloud Coding Plan** pentru o cheie internațională Coding Plan (`sk-sp-`). Folosește conexiunea Singapore. QwenCloud Standard și Token Plan au opțiuni și chei de cont proprii.
3. Alege **Xiaomi MiMo API** pentru o cheie API de inferență în timp real (`sk-`) pe adresa globală. Pentru **Xiaomi MiMo Token Plan**, selectează regiunea din pagina Token Plan (China, Singapore sau Europa) și folosește cheia individuală (`tp-`) sau de echipă (`ttp-`).
4. Selectează **Descoperă modele** dacă este disponibil sau introdu ID-ul exact al modelului de chat din consola furnizorului. Alege **Salvează**, apoi **Testează**. Testul folosește adresa selectată și poate consuma cotă. Alege un model în sesiune sau în workbench.

Încearcă `qwen3.7-flash` în Model Studio, `qwen3.7-plus` în Coding Plan sau `mimo-v2.6-flash` în MiMo, dacă ai acces în cont. Prezența unui model în catalog nu confirmă accesul. Capabilitățile altor ID-uri introduse manual pot rămâne neverificate. Pentru altă regiune sau alt spațiu de lucru, adaugă un furnizor nou.

Consultă [Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq), [MiMo API](https://mimo.mi.com/docs/en-US/api/chat/openai-api-post), [MiMo Token Plan](https://mimo.mi.com/docs/tokenplan/subscription).

Folosește Alibaba Coding Plan în instrumente interactive de programare acceptate, conform politicii Alibaba. Folosește MiMo Token Plan pentru programare, conform politicii de utilizare Xiaomi.

## Fireworks AI, Together AI, Groq și Cerebras

1. Selectează **Adaugă furnizor** și alege serviciul și introdu o cheie API din consola acestuia. VERA completează adresa serviciului și stochează separat cheia fiecărei conexiuni.
2. Alege **Descoperă modele** sau introdu ID-ul complet al modelului și limitele sale. Păstrează prefixul contului pentru Fireworks, de exemplu `accounts/fireworks/models/glm-5p3-flash`. Pentru un punct de acces dedicat, copiază ID-ul exact de inferență din serviciu.
3. Salvează și alege **Testează** pentru a verifica cheia și modelul ales. Suportul pentru instrumente și imagini apare când este specificat în catalog sau în documentația modelului. Verifică limitele serviciului și accesul la modele pentru contul tău.

Consultă listele de modele pentru [Fireworks AI](https://fireworks.ai/models), [Together AI](https://docs.together.ai/docs/serverless/models), [Groq](https://console.groq.com/docs/models) și [Cerebras](https://inference-docs.cerebras.ai/models/overview).

## Hugging Face Inference Providers, NVIDIA NIM și Vercel AI Gateway

1. Selectează **Adaugă furnizor** și alege serviciul și introdu cheia lui. Pentru Hugging Face, folosește un token de acces cu permisiunea Inference Providers. Pentru NVIDIA NIM, folosește o cheie cu acces la NVIDIA Public API Endpoints. Pentru Vercel, folosește o cheie AI Gateway.
2. Alege **Descoperă modele** și selectează un model sau introdu ID-ul complet și limitele unui model cu acces restricționat sau specific contului. Păstrează prefixul și barele oblice. În Hugging Face, păstrează un sufix precum `owner/model:novita` dacă alegi explicit furnizorul din spatele serviciului.
3. Salvează și alege **Testează** pentru a verifica modelul ales cu cheia ta. Prezența în catalog nu garantează accesul contului. Dacă accesul eșuează, verifică în serviciu ID-ul exact și permisiunile sau planul înainte de a schimba conexiunea.

VERA trimite solicitările către serviciul indicat în selectorul de modele. [Hugging Face](https://huggingface.co/docs/inference-providers/index) și [Vercel](https://vercel.com/docs/ai-gateway/models-and-providers) direcționează solicitările mai departe. [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) rulează modelul găzduit selectat. Selectorul afișează tipurile de intrare și suportul pentru instrumente când sunt documentate.

## LM Studio

1. Pornește serverul LM Studio și încarcă un model.
2. **Adaugă furnizor**, **Furnizor** LM Studio. Adresa `http://localhost:1234` este completată automat.
3. Selectează **Testează conexiunea**. VERA citește modelele de conversație ale serverului; modelele de embedding sunt omise.
4. Pentru fiecare model, verifică limita de context afișată de VERA. Dacă serverul nu raportează niciuna, seteaz-o tu. Valorile opționale **Raționament** și **Temperatură** rămân pe **Implicit la furnizor** dacă nu le setezi.
5. Selectează **Salvează**.

Pentru LM Studio, cheia API este opțională.

## Ollama și alte endpointuri compatibile

1. **Adaugă furnizor**, **Furnizor** Ollama sau **Alt furnizor compatibil**. Pentru Ollama, **URL de bază** `http://localhost:11434/v1` este completat automat.
2. Introdu **Numele endpoint-ului**, **URL de bază** (o adresă `http` sau `https` care se termină în `/v1`), numele de la **Model** așa cum îl cunoaște serverul, **Fereastră de context (tokenuri)** și **Ieșire maximă (tokenuri)**.
3. Introdu **Cheia API a endpoint-ului** dacă serverul are nevoie de una sau lasă câmpul gol.
4. Selectează **Salvează**.

Ia fereastra de context din documentația modelului sau din setările serverului. O valoare prea mare duce la erori de la server; una prea mică face ca VERA să rezume istoricul mai devreme decât este necesar.

## Modele locale lente

Un model local poate avea nevoie de câteva minute ca să se încarce sau să citească un prompt lung. **Timp de așteptare a răspunsului (s)** stabilește cât așteaptă VERA primul răspuns și apoi fiecare parte a răspunsului, între 10 și 3600 de secunde; valoarea inițială este 300. Raționamentul trimis de server contează ca răspuns, așa că un model care încă gândește nu este oprit.

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
| **Modelul nu a răspuns în … s.** | Mărește **Timp de așteptare a răspunsului (s)** pentru conexiune sau verifică dacă serverul rulează |

Vezi și [Depanare](troubleshooting.md).
