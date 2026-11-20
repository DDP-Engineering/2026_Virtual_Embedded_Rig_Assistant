# Providers and models

A provider gives VERA access to a language model. You need at least one. Set providers up in **Settings** → **Providers**, which has two parts: **Subscriptions** and **API / local connections**.

Under **Add connection**, use **Search providers** to find a provider by name.

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

## OpenCode Console and OpenCode Go

1. In OpenCode Console, create a workspace API key. Give the key permission to read models and run inference.
2. In VERA, choose **Add connection**, then **OpenCode Console** for pay-as-you-go or **OpenCode Go** for a Go subscription.
3. Enter the key and select **Discover models**. Choose a model from the plan’s list, or enter its exact ID and limits if you are configuring it manually.
4. Select **Save**, then **Test**. Choose the model for your session or workbench.

VERA stores each connection’s key separately. You can use the same key in both connections if the workspace has credits and a Go subscription. Free Console models are available only in OpenCode. Check your workspace’s limits and the Go Extra Usage setting to see when OpenCode can bill your workspace balance.

The catalog reports model capabilities. Use **Test** to check tool calling and streaming for your selected model.

See [OpenCode harness setup](https://opencode.ai/docs/console/harnesses) and the [Go plan guide](https://opencode.ai/docs/console/go/).

## QwenCloud Standard and QwenCloud Token Plan

1. Under **Add connection**, select **QwenCloud Standard** for a Singapore pay-as-you-go API key or **QwenCloud Token Plan** for the dedicated Token Plan key (`sk-sp-`). VERA fills the Base URL for the selected plan.
2. Enter the matching key and select **Discover models**. If the list is unavailable, enter the exact model ID for your region or plan. For example, `qwen3.8-flash` accepts text and images and supports tool calling and a thinking toggle. `qwen3.7-max` supports tool calling and the thinking toggle with text input. Capabilities for other model IDs may be unverified.
3. Select **Save**, then **Test**. If catalog reachability is skipped, **Authentication and model** checks the key and model using chat inference. Choose the model for your session or workbench.

Use Token Plan for interactive agent sessions under the [Token Plan usage policy](https://docs.qwencloud.com/token-plan/token-plan-permissions-and-usage). If the plan runs out of credits, check its usage and quota. For a request rate limit, wait before retrying.

See [QwenCloud API keys](https://docs.qwencloud.com/developer-guides/administration/api-keys) and [Token Plan models and errors](https://docs.qwencloud.com/token-plan/token-plan-faq).

## DeepSeek, Moonshot AI and Kimi For Coding

1. In **Add connection**, choose **DeepSeek** for a DeepSeek API key, **Moonshot AI** for an international Kimi API Platform key, or **Kimi For Coding** for a key from the Kimi Code Console. VERA fills in the matching base URL.
2. Enter the service's key. For DeepSeek and Moonshot AI, select **Discover models** or enter the exact model ID. For Kimi For Coding, enter an ID such as `kimi-for-coding` or `k3-256k`, depending on your membership.
3. Select **Save**, then **Test**. For Kimi For Coding, **Reachability** is skipped and **Authentication and model** checks the key and model through inference.

Use the exact Kimi For Coding model ID. Kimi Code may answer a mistyped ID with a fallback model. A passing probe leaves capabilities for unverified Kimi IDs unknown.

DeepSeek Flash, Moonshot AI's Kimi K3 and the two Kimi Code examples accept text and images in VERA. DeepSeek V4 Pro accepts text. Capabilities for other model IDs may be unverified.

See [DeepSeek model limits](https://api-docs.deepseek.com/api/list-models/), the [Moonshot Kimi K3 guide](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) and [Kimi Code model configuration](https://www.kimi.com/code/docs/en/kimi-code/models).

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

The model choices show the provider, context limit, input types and available tool or reasoning information. **Tools unverified** means tool calling has not been confirmed for that model.

## Common errors

| Message | What to do |
|---|---|
| **Authentication failed. Check the saved credential in Providers settings.** | Enter the key again, or sign in again |
| **Provider rate limit.** | Wait the time shown, then retry |
| **The provider rejected the context size.** | Shorten the input, or correct **Context window (tokens)** |
| **Cannot reach …** | Start the local server, or check the network and the **Base URL** |

See also [Troubleshooting](troubleshooting.md).
