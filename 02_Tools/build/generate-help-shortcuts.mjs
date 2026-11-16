import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { software } from "../environment/software.mjs";

/** The words of the generated page that the interface catalogs do not hold. */
const words = {
  en: {
    bookmark:
      "Tab from a focused single-message rail marker to its bookmark action; Enter or Space toggles it. Escape closes the preview and returns focus to the marker.",
    intro:
      "These are VERA's default keyboard shortcuts. Change, add or remove them in **{where}**; see [Settings](settings.md).",
    action: "Action",
    keys: "Shortcut",
    description: "What it does",
    fixed: "Fixed keys",
    f1: "Open the help page of the current screen.",
    f10: "Move to the File, Edit and View menus.",
    shortcuts: "Open {where}.",
  },
  ro: {
    bookmark:
      "De la un reper individual focalizat, Tab ajunge la acțiunea de marcaj; Enter sau Spațiu o activează. Escape închide previzualizarea și readuce focalizarea la reper.",
    intro:
      "Acestea sunt scurtăturile de tastatură implicite ale VERA. Le poți schimba, adăuga sau elimina în **{where}**; vezi [Setări](settings.md).",
    action: "Acțiune",
    keys: "Scurtătură",
    description: "Ce face",
    fixed: "Taste fixe",
    f1: "Deschide pagina de ajutor a ecranului curent.",
    f10: "Mută focalizarea pe meniurile Fișier, Editare și Vizualizare.",
    shortcuts: "Deschide {where}.",
  },
  de: {
    bookmark:
      "Von einer fokussierten Einzelmarkierung führt Tab zur Lesezeichenaktion; Eingabe oder Leertaste schaltet sie um. Escape schließt die Vorschau und setzt den Fokus auf die Markierung zurück.",
    intro:
      "Dies sind die Standard-Tastenkürzel von VERA. Ändern, ergänzen oder entfernen Sie sie unter **{where}**; siehe [Einstellungen](settings.md).",
    action: "Aktion",
    keys: "Tastenkürzel",
    description: "Funktion",
    fixed: "Feste Tasten",
    f1: "Öffnet die Hilfeseite des aktuellen Bildschirms.",
    f10: "Wechselt zu den Menüs Datei, Bearbeiten und Ansicht.",
    shortcuts: "Öffnet {where}.",
  },
  fr: {
    bookmark:
      "Depuis un repère individuel ciblé, Tab atteint l’action de signet ; Entrée ou Espace la bascule. Échap ferme l’aperçu et ramène le focus au repère.",
    intro:
      "Voici les raccourcis clavier par défaut de VERA. Modifiez-les, ajoutez-en ou supprimez-les dans **{where}** ; voir [Paramètres](settings.md).",
    action: "Action",
    keys: "Raccourci",
    description: "Effet",
    fixed: "Touches fixes",
    f1: "Ouvre la page d’aide de l’écran actuel.",
    f10: "Passe aux menus Fichier, Édition et Affichage.",
    shortcuts: "Ouvre {where}.",
  },
};

const cell = (text) => text.replaceAll("|", "\\|");

/** `help/<language>/shortcuts.md` for every help language, from the shared shortcut registry and the UI catalogs. */
export async function shortcutPages() {
  const registry = await import(
    pathToFileURL(join(software, "src/libraries/shared/src/keyboard-shortcuts.ts")).href
  );
  const pages = {};
  for (const [language, text] of Object.entries(words)) {
    const catalog = JSON.parse(
      await readFile(join(software, "src/apps/desktop/src/renderer/locales", `${language}.json`), "utf8"),
    );
    const labels = catalog.keyboard;
    const where = `${catalog.nav.settings} → ${catalog.settings.shortcuts}`;
    const rows = registry.shortcutCommands.map((command) => {
      const keys = registry.defaultShortcuts[command].map((binding) => binding.replace("Mod", "Ctrl"));
      const description =
        command === "shortcuts" ? text.shortcuts.replace("{where}", where) : labels[`${command}Desc`];
      return `| ${cell(labels[command])} | ${keys.length ? keys.join(", ") : cell(labels.unassigned)} | ${cell(description)} |`;
    });
    pages[language] = [
      `# ${labels.shortcuts}`,
      "",
      text.intro.replace("{where}", where),
      "",
      `| ${text.action} | ${text.keys} | ${text.description} |`,
      "|---|---|---|",
      ...rows,
      "",
      `## ${text.fixed}`,
      "",
      `| ${text.keys} | ${text.description} |`,
      "|---|---|",
      `| F1 | ${text.f1} |`,
      `| F10 | ${text.f10} |`,
      "",
      text.bookmark,
      "",
    ].join("\n");
  }
  return pages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [language, text] of Object.entries(await shortcutPages()))
    await writeFile(join(software, "help", language, "shortcuts.md"), text);
  console.log("help: shortcuts.md generated for en, ro, de, fr");
}
