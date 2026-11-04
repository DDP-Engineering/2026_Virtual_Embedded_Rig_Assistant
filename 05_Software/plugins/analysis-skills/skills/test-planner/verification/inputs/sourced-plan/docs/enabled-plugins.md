# Enabled plugin metadata for fictional acceptance session

The fixture installs and enables analysis-skills, esp32-esptool and serial-monitor without provisioning or executing programs.

Official esp32-esptool metadata: program esptool; command write-flash; risk device-write (overwrites firmware/data). Official serial-monitor metadata: program serial; command capture; risk device-read (opens console; reset may restart board). Name these only as optional future steps. No verified port, image path or flash offset is supplied.
