# Providers and models

A provider gives VERA access to a language model. You need at least one. Set providers up in **Settings** → **Providers**, which has two parts: **Subscriptions** and **API / local connections**.

## ChatGPT subscription

1. Under **ChatGPT subscription**, select **Sign in with ChatGPT**. Your system browser opens the sign-in page.
2. Sign in there. VERA shows **Signed in with ChatGPT** when it is done.

The token renews automatically. **Sign out** removes it.

- If sign-in does not complete, paste the final address from the browser into **Paste the final redirect URL if sign-in does not complete** and select **Complete sign-in**.
- Sign-in times out after 10 minutes.
- If port 1455 is busy, a sign-in in the Codex CLI is often still open. Cancel it and try again.

## OpenAI API

1. Under **API / local connections**, select **Add connection** and choose **OpenAI API** as **Provider**.
2. Enter the **OpenAI API key** and, optionally, an **OpenAI model**.
3. Select **Save**.

## LM Studio

1. Start the LM Studio server and load a model.
2. **Add connection**, **Provider** LM Studio. The address `http://localhost:1234` is filled in.
3. Select **Test connection**. VERA reads the server's conversation models; embedding models are left out.
4. For each model, check the context limit VERA shows. If the server reports none, set it yourself. Optional **Reasoning** and **Temperature** stay at **Provider default** unless you set them.
5. Select **Save**.

An API key is optional for LM Studio.

## Ollama and other compatible endpoints

1. **Add connection**, **Provider** Ollama or **Other compatible provider**. For Ollama the **Base URL** `http://localhost:11434/v1` is filled in.
2. Enter an **Endpoint name**, the **Base URL** (an `http` or `https` address ending in `/v1`), the **Model** name as the server knows it, the **Context window (tokens)** and the **Maximum output (tokens)**.
3. Enter an **Endpoint API key** if the server needs one, or leave it empty.
4. Select **Save**.

Take the context window from the model's documentation or your server settings. A value that is too large leads to errors from the server; one that is too small makes VERA summarize history earlier than needed.

## Image support

The composer warns when the current model receives only image paths.

VERA reads image support from the ChatGPT and OpenAI API model catalogs. For LM Studio, Ollama or another compatible endpoint, select or enter the model, turn on **Accepts images** if it supports image input, and select **Save**. The switch starts off for each model.

An image sent to a model leaves your computer if the provider runs remotely. Text masking applies to image paths according to your settings. The model receives the image pixels directly.

## Test a connection

**Test** runs four checks: **Reachability**, **Authentication and model**, **Tool calling** and **Streaming**. Each shows **Pass**, **Fail** or **Skipped**. The agent uses tool calls to search documents, read and change files and run programs, so choose a model that passes **Tool calling**.

## Keys and secure storage

Keys are stored encrypted with your operating system's secure storage. When that is not available, VERA asks you to choose: **Use only for this run** keeps the key in memory until VERA closes, **Store without secure encryption** saves it in a file that anyone with access to your account can read. To replace a key, enter a new one; to remove it, use **Remove the saved key**. **Remove** deletes a connection.

## Choose a model

- For one session: pick the **Model** next to the message box.
- For a workbench: **Edit workbench** → **Agent and chat** → **Default model**, written as `provider/model`. Leave it empty to use the application default.

The session choice wins over the workbench default, and the workbench default over the application default.

## Common errors

| Message | What to do |
|---|---|
| **Authentication failed. Check the saved credential in Providers settings.** | Enter the key again, or sign in again |
| **Provider rate limit.** | Wait the time shown, then retry |
| **The provider rejected the context size.** | Shorten the input, or correct **Context window (tokens)** |
| **Cannot reach …** | Start the local server, or check the network and the **Base URL** |

See also [Troubleshooting](troubleshooting.md).
