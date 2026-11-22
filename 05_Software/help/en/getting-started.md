# Getting started

This page takes you from the first start to a first answer with citations. It takes a few minutes, plus the time VERA needs to index your documents.

## What you need

- VERA installed on Windows x64 or Linux x64. Without network, see [Offline installation](offline-install.md).
- Access to an AI model: an OpenAI API key, a ChatGPT subscription, or a local model server such as LM Studio or Ollama.
- A project folder on a local disk, ideally with its documentation (datasheets, reference manuals, schematics as PDF, notes in Markdown).

## First start

VERA opens on **Home**, which lists your **Workbenches** and offers **Create a workbench**. The sidebar holds **New Workbench**, **Open Workbench** and **Plugins**; **Settings** is at the bottom of the sidebar.

To change the interface language first, open **Settings** → **Appearance and language** and choose an **Interface language**.

## Step 1: connect a provider

1. Open **Settings** → **Providers**.
2. Choose one of these:
   - ChatGPT subscription: select **Add provider**, choose **ChatGPT subscription** as **Provider**, select **Sign in with ChatGPT** and finish the sign-in in your browser.
   - API key or local server: select **Add provider**, choose the **Provider** (**OpenAI API**, LM Studio, Ollama or **Other compatible provider**), fill in the fields and select **Save**.
3. Select **Test** next to the connection. All four steps (**Reachability**, **Authentication and model**, **Tool calling**, **Streaming**) should show **Pass**.

Details are in [Providers and models](providers.md).

## Step 2: create a workbench

1. Select **New Workbench**.
2. Select **Choose folder** and pick your project folder. The name is filled in from the folder name.
3. Under **Documents & RAG**, check the documentation folders VERA found, or use **Add folder…**.
4. Select **Create a workbench**.

VERA starts indexing in the background. You can already chat; the **Files** tab of the right panel shows the indexing progress. See [Workbenches](workbenches.md) and [Documents and search](documents-and-search.md).

## Step 3: ask a first question

1. Select **New session**.
2. In the controls of the message box, pick a **Model**. Leave the permission mode at **Ask** for now.
3. Type a question about your project, for example "What is the maximum SPI clock of the sensor, and which pins does it use?", and press Enter.

The agent searches your documents, reads the relevant pages and answers. Citation chips in the answer name the source; select one to open the document at the cited page, heading or line.

If the agent wants to change a file or run a program, it asks first with an approval card. See [Permissions](permissions.md).

## Next steps

- Let the agent work with your bench tools: [Plugins](plugins.md).
- Learn how sessions, steering and export work: [Chat and sessions](chat-and-sessions.md).
- Adjust text sizes, theme and updates: [Settings](settings.md).
