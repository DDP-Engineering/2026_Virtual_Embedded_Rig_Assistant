import {
  formatRef,
  type HelpLanguage,
  helpLanguageSchema,
  helpPageNameSchema,
  pluginIdSchema,
  veraErrorSchema,
} from "@vera/shared";
import { z } from "zod";
import { waitForAbort } from "../abort.js";
import { type HelpLibrary, readPluginHelp } from "../help/library.js";
import type { ToolDefinition } from "./context.js";
import { textPage } from "./text-page.js";

/** What the help tool may read: the app help, the user's language and the workbench's enabled plugins. */
export interface HelpHost {
  app: HelpLibrary;
  /** The user's interface language, the default language of help reads. */
  language(): HelpLanguage;
  /** The plugins enabled in the session's workbench, with their package folders. */
  plugins(signal?: AbortSignal): Promise<readonly { id: string; folder: string }[]>;
}

const params = z
  .strictObject({
    page: helpPageNameSchema.optional(),
    plugin: pluginIdSchema.optional(),
    language: helpLanguageSchema.optional(),
    offset: z.number().int().positive().optional(),
  })
  .refine((args) => !(args.page && args.plugin), "Name a page or a plugin, not both.")
  .refine(
    ({ page, plugin, offset }) => offset === undefined || page || plugin,
    "Use offset when reading a page or plugin.",
  );

/** Read-only VERA help for questions about the application itself (REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6). */
export const helpTool: ToolDefinition = {
  name: "help",
  class: "read",
  description:
    "Read VERA's own user help: screens, settings, permissions, providers and plugins. Without arguments, list app help and help for enabled plugins. Read Markdown by page or plugin; when nextOffset is present, repeat the request with offset set to that value. Cite the exact returned ref, including its language, for example [[help:permissions#lang=en]].",
  params,
  async execute(ctx, raw, signal) {
    signal.throwIfAborted();
    const host = ctx.help;
    if (!host) throw Error("VERA help is unavailable in this host.");
    const args = params.parse(raw);
    const language = args.language ?? host.language();
    if (args.page) {
      const page = await host.app.read(args.page, language, signal).catch((error: unknown) => {
        if (veraErrorSchema.safeParse(error).data?.code === "NOT_FOUND")
          throw Error(
            `Help page ${args.page} does not exist. Call help without arguments to list the pages.`,
          );
        throw error;
      });
      const ref = formatRef({ kind: "help", page: page.page, language: page.language });
      return textPage(
        ctx,
        { ref, title: ctx.maskText?.(page.title) ?? page.title, language: page.language },
        page.content,
        args.offset,
      );
    }
    const enabled = await waitForAbort(host.plugins(signal), signal);
    if (args.plugin) {
      const plugin = enabled.find((entry) => entry.id === args.plugin);
      if (!plugin)
        throw Error(`Plugin ${args.plugin} is not enabled in this workbench; its help is unavailable.`);
      const page = await readPluginHelp(plugin.folder, language, signal);
      if (!page) throw Error(`Plugin ${args.plugin} has no help.`);
      const ref = formatRef({ kind: "help", plugin: plugin.id, language: page.language });
      return textPage(
        ctx,
        { ref, title: ctx.maskText?.(page.title) ?? page.title, language: page.language },
        page.content,
        args.offset,
      );
    }
    const pages = (await host.app.list(language, signal)).map((page) => ({
      ...page,
      ref: formatRef({ kind: "help", page: page.page, language: page.language }),
    }));
    const plugins = [];
    for (const plugin of enabled) {
      const page = await readPluginHelp(plugin.folder, language, signal);
      if (page)
        plugins.push({
          plugin: plugin.id,
          title: page.title,
          language: page.language,
          ref: formatRef({ kind: "help", plugin: plugin.id, language: page.language }),
        });
    }
    return { language, pages, plugins };
  },
};
