# VERA — Virtual Embedded Rig Assistant

**A desktop agent workbench for electronics and embedded engineering.**

VERA is a desktop application in the style of Claude Code, Codex and opencode, organised around a
virtual workbench: a local folder that holds a project's documents, skills and tools. You chat with
a model; the agent searches the documents, reads and edits workbench files with your approval, and
saves session artifacts.

**Status:** the VERA 1.0 plan (milestones M0–M5) is implemented; later work is planned in
[00_Planning](00_Planning/README.md).

**Setup** (Windows or Ubuntu, needs Python 3.11+ and Git): `python 02_Tools/environment/setup.py` installs the
pinned Node.js and the npm packages inside the repository. Details: [02_Tools](02_Tools/README.md).

| Folder | Content |
|---|---|
| [00_Planning](00_Planning/README.md) | architecture, decisions and the implementation plan |
| [01_Documentation](01_Documentation/README.md) | project-wide documentation |
| [02_Tools](02_Tools/README.md) | environment, build and release tooling; the local toolchain |
| [03_Hardware](03_Hardware/README.md) | hardware profiles and bench setups |
| [04_HardwareDocu](04_HardwareDocu/README.md) | datasheets and hardware references |
| [05_Software](05_Software/README.md) | VERA source, functional tests and evaluators |
| [06_SoftwareDocu](06_SoftwareDocu/README.md) | software documentation |
| [07_Delivery](07_Delivery/README.md) | packages and release notes |
| [09_Others](09_Others/README.md) | supporting material |
