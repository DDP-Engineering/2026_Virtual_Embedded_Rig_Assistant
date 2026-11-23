import { type HelpLanguage, helpLanguageSchema, helpPageNameSchema, pluginIdSchema } from "@vera/shared";
import { z } from "zod";
import { type HelpLibrary, readPluginHelp } from "../help/library.js";
import type { ToolDefinition } from "./context.js";

/** What the help tool may read: the app help, the user's language and the workbench's enabled plugins. */
export interface HelpHost {
  app: HelpLibrary;
  /** The user's interface language, the default language of help reads. */
  language(): HelpLanguage;
  /** The plugins enabled in the session's workbench, with their package folders. */
  plugins(): Promise<readonly { id: string; folder: string }[]>;
}

const params = z
  .strictObject({
    page: helpPageNameSchema.optional(),
    plugin: pluginIdSchema.optional(),
    language: helpLanguageSchema.optional(),
  })
  .refine((args) => !(args.page && args.plugin), "Name a page or a plugin, not both.");

async function enabledPlugin(host: HelpHost, id: string) {
  const plugin = (await host.plugins()).find((entry) => entry.id === id);
  if (!plugin) throw Error(`Plugin ${id} is not enabled in this workbench; its help is unavailable.`);
  return plugin;
}

/** Read-only VERA help for questions about the application itself (REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6). */
export const helpTool: ToolDefinition = {
  name: "help",
  class: "read",
  description:
    "Read VERA's own user help: how VERA works, its screens, settings, permissions, providers and plugins. Without arguments it lists the help pages and the help of the plugins enabled in this workbench; with page or plugin it returns that page's Markdown. Cite the exact returned ref inside double square brackets. For example, if the tool returns help:permissions, write [[help:permissions]].",
  params,
  async execute(ctx, raw) {
    const host = ctx.help;
    if (!host) throw Error("VERA help is unavailable in this host.");
    const args = params.parse(raw);
    const language = args.language ?? host.language();
    if (args.page) {
      const page = await host.app.read(args.page, language).catch(() => {
        throw Error(`Help page ${args.page} does not exist. Call help without arguments to list the pages.`);
      });
      return { ref: `help:${page.page}`, title: page.title, language: page.language, text: page.content };
    }
    if (args.plugin) {
      const plugin = await enabledPlugin(host, args.plugin);
      const page = await readPluginHelp(plugin.folder, language);
      if (!page) throw Error(`Plugin ${args.plugin} has no help.`);
      return {
        ref: `help:plugin/${plugin.id}`,
        title: page.title,
        language: page.language,
        text: page.content,
      };
    }
    const pages = (await host.app.list(language)).map((page) => ({ ...page, ref: `help:${page.page}` }));
    const plugins = [];
    for (const plugin of await host.plugins()) {
      const page = await readPluginHelp(plugin.folder, language);
      if (page)
        plugins.push({
          plugin: plugin.id,
          title: page.title,
          language: page.language,
          ref: `help:plugin/${plugin.id}`,
        });
    }
    return { language, pages, plugins };
  },
};
