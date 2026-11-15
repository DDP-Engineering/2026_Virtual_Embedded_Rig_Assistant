# Plăci virtuale Renode

Acest plugin îi permite agentului să ruleze un ELF de firmware pe o placă virtuală suportată, cu Renode 1.17.0 fixat, înainte de a avea hardware sau fără el. Agentul listează profilurile de plăci suportate, verifică un firmware față de arhitectura, harta de memorie și adresa de boot ale unui profil înainte să ruleze ceva, îl pornește headless, îi capturează UART-ul și rulează seturi de teste aprobate (linii UART, tick-uri de timer, stimuli de buton și UART, LED-ul modelat) cu bugete separate de timp virtual și real. Rezultatele ajung în `embedded-lab-results/` și contează întotdeauna ca dovezi virtuale, nu ca test pe hardware.

## Ce necesită

- **Renode 1.17.0.** **Instalează dependențele** descarcă pachetul portabil fixat în folderul de programe al VERA și îi verifică SHA-256; merge și un Renode 1.17.0 din PATH. O altă versiune a motorului blochează rularea.
- **renode-sim**, un script Python din plugin, pe care VERA îl instalează singură. Agentul lucrează întotdeauna prin el.
- Un ELF de firmware compilat pentru o placă suportată. Primul profil este `stm32f4-discovery` (STM32F407, Cortex-M4F), cu setul de teste aprobat `board-basics`.
- Fără hardware, fără alte pluginuri și fără configurare. Poți adăuga propriile profiluri în `renode/profiles/<id>/` și seturi de teste în `renode/tests/<id>/` din workbench; sunt verificate la fel ca cele ale pluginului.

## Cum se folosește

Agentul folosește skill-ul `virtual-boards`. Declară explicit arhitectura și adresa de boot și nu trece niciodată la alt profil doar ca să treacă o verificare.

- „Ce plăci virtuale sunt suportate?”
- „Verifică build/app.elf față de stm32f4-discovery ca cortex-m4, cu adresa de boot 0x08000000.”
- „Pornește firmware-ul pe placa virtuală timp de 2 secunde virtuale și arată ieșirea UART.”
- „Rulează setul de teste board-basics cu versiunea 1.2.3.”
- „Scrie un raport al rulării virtuale alături de rularea HIL.”

## Risc și aprobări

Toate operațiile renode-sim (tools, profiles, validate, run, capture-uart, test, report) au nivelul **Sigur**: rulează doar pe computerul tău, nu folosesc niciun dispozitiv, listener de rețea sau fișier de pe gazdă din afara noului folder de rulare și rulează fără să întrebe. Rularea directă a Renode are nivelul **Blocat**, pentru că monitorul lui poate rula Python, poate include scripturi, poate descărca fișiere și poate deschide socket-uri sau dispozitive ale gazdei.

## Limitări

- Windows x64 și Linux x64; Ubuntu nativ nu a fost încă verificat.
- Rulează doar profilurile aprobate; nu există acces la consola Renode, la comenzi de monitor, la scripturi `.resc` sau la Robot Framework.
- Dacă firmware-ul folosește un periferic pe care modelul nu îl implementează, rezultatul este incomplet. Modelul STM32F4 nu simulează arborele de ceas, timpii pe cicluri, DAC, ADC, USB, SDIO, DCMI sau componentele externe ale plăcii.
- Timpul virtual este timp simulat. O simulare nu spune nimic despre temporizarea electrică, consumul de energie, EMI sau circuitul analogic.
- Un fișier `.repl` din workbench trebuie verificat ca orice cod.
