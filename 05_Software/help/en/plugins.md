# Plugins

Plugins let the agent drive the tools of your bench: flashing and debugging tools, serial monitors, bus analyzers, simulators, instruments. A plugin declares its programs, how VERA installs them, the risk level of each command, and skills that teach the agent to use them. Each installed plugin has its own help page in Help and on its card.

## Find and install a plugin

1. On the **Plugins** page, select **Browse available plugins**. Filter by **Ecosystem**, **Activity**, **Provenance**, **Maturity** or state, or search.
2. Open **Details** to see what the plugin needs, including required plugins and programs.
3. Select **Install**, or **Install with dependencies** to also install the required plugins and the programs VERA can install itself.
4. Check the review and confirm.

A card warns when the plugin is not available for your platform or can write to a device or change it permanently. Versions below 1.0.0 are marked **Pre-release**.

## Install a pack

**Install a pack** installs the plugins of one ecosystem, such as ESP32, STM32 or Electronics design. Check the groups you need, select **Review pack**, then **Install with dependencies**. Plugins that are already installed or not available for your platform are left out.

## Review and trust

Before installing, VERA shows a review: what the plugin contains (**Programs** and where they come from, **Skills**, **Profiles and data files**, **Documents**) and the **Operations**, the plugin's command rules grouped by risk level. Updates that change programs, sources or rules are reviewed again. If the plugin's files change after installation, VERA stops using it until you install it again.

Plugins carry a tier:

| Tier | Origin |
|---|---|
| **Official** | From the catalog, marked official there |
| **Community** | Every other plugin from the catalog |
| **Local** | Installed by you with **Install from folder…** or **Install from zip…** |
| **Trial** | Drafted by the agent in a session; every command asks for approval, also in Bypass. **Promote to local** trusts it |

A workbench can also carry plugin packages in `.vera/plugins/`. They are used only after you select **Review workbench plugin** and **Trust this package**; trust is stored on this computer only, and any change to the package needs a new review.

## Enable a plugin for a workbench

Installing does not enable a plugin. Open **Edit workbench** → **Plugins**, check the plugin and select **Save**. Only enabled plugins are offered to the agent in that workbench.

## Dependencies

The **Status** block of an installed plugin checks two things: **Dependencies** and **Configuration**. It shows **Ready** only when both are ready.

- **Check dependencies** looks for the programs; **Check all dependencies** does this for every plugin.
- **Install dependencies** installs what VERA can install itself (Python packages, scripts and pinned downloads) into its own program folder. Each download is checked against its SHA-256.
- Vendor programs such as KiCad, LTspice or STM32CubeProgrammer are **Managed externally**: install them with **Installation guide**, then check again.
- **Re-install** downloads VERA's program copies again and replaces them.
- **Install from dependency archive…** installs a program from an archive you downloaded yourself; VERA checks it against the plugin's SHA-256.

## Parameters

Some plugins need settings, marked **Needs configuration** and entered in their **Configuration** section: for example MQTT broker logins, Wokwi tokens, supplier keys for parts search, or a workbench file such as a bench resource list. Secrets go only to an approved run of that plugin; the agent never sees them.

## Program runs

Every command the agent runs goes through your permission mode (see [Permissions](permissions.md)). The **Runs** tab of the right panel lists the workbench's runs; **Open log** shows the output and **Stop** ends a running program. Logs are kept in `.vera/runs/`.

## Updates and the catalog

**Check for updates** looks for new plugin versions; an update shows **Update to …**. VERA also checks once a day unless updates are turned off in [Settings](settings.md). Under **Catalog settings** you choose the **Channel** (**Stable** or **Pre-release**) and an optional **Catalog URL**, for example your company's mirror. VERA uses a catalog only when its signature matches; otherwise it shows the plugins bundled with VERA.

**Uninstall** and **Export zip** are under **More actions** on an installed card. Without network, see [Offline installation](offline-install.md).
