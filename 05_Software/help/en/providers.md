# Providers and models

A provider gives VERA access to a language model. You need at least one. Set providers up in **Settings** → **Providers**. Select **Add provider** and choose the provider in the **Provider** list. The list includes the **ChatGPT subscription**.

Select a connected provider on the left to see its actions and models. Use **Edit**, **Test** or **Remove** for API and local connections, and **Sign out** for the ChatGPT subscription. The test shows progress beside **Test**. Open **Test details** for the result of each step.

Tick the models to offer them in the chat and workbench pickers. Use **Default** to set the application-wide model. **Save** at the top right applies the ticks and default together. **Cancel** discards the changes. To find a model in a long list, use **Filter models** and the pager.

## ChatGPT subscription

1. Select **Add provider**, choose **ChatGPT subscription** as **Provider** and select **Sign in with ChatGPT**. Your system browser opens the sign-in page.
2. Sign in there. VERA shows **Signed in with ChatGPT** when it is done.

The token renews automatically. **Sign out** removes it.

- If sign-in does not complete, paste the final address from the browser into **Paste the final redirect URL if sign-in does not complete** and select **Complete sign-in**.
- Sign-in times out after 10 minutes.
- If port 1455 is busy, a sign-in in the Codex CLI is often still open. Cancel it and try again.

## OpenAI API

1. Select **Add provider** and choose **OpenAI API** as **Provider**.
2. Enter the **OpenAI API key** and, optionally, an **OpenAI model**.
3. Select **Save**.

## OpenCode Console and OpenCode Go

1. In OpenCode Console, create a workspace API key. Give the key permission to read models and run inference.
2. In VERA, select **Add provider**, then choose **OpenCode Console** for pay-as-you-go or **OpenCode Go** for a Go subscription.
3. Enter the key and select **Discover models**. Choose a model from the plan’s list, or enter its exact ID and limits if you are configuring it manually.
4. Select **Save**, then **Test**. Choose the model for your session or workbench.

VERA stores each connection’s key separately. You can use the same key in both connections if the workspace has credits and a Go subscription. Free Console models are available only in OpenCode. Check your workspace’s limits and the Go Extra Usage setting to see when OpenCode can bill your workspace balance.

The catalog reports model capabilities. Use **Test** to check tool calling and streaming for your selected model.

See [OpenCode harness setup](https://opencode.ai/docs/console/harnesses) and the [Go plan guide](https://opencode.ai/docs/console/go/).

## QwenCloud Standard and QwenCloud Token Plan

1. Select **Add provider** and choose **QwenCloud Standard** for a Singapore pay-as-you-go API key or **QwenCloud Token Plan** for the dedicated Token Plan key (`sk-sp-`). VERA fills the Base URL for the selected plan.
2. Enter the matching key and select **Discover models**. If the list is unavailable, enter the exact model ID for your region or plan. For example, `qwen3.8-flash` accepts text and images and supports tool calling and a thinking toggle. `qwen3.7-max` supports tool calling and the thinking toggle with text input. Capabilities for other model IDs may be unverified.
3. Select **Save**, then **Test**. If catalog reachability is skipped, **Authentication and model** checks the key and model using chat inference. Choose the model for your session or workbench.

Use Token Plan for interactive agent sessions under the [Token Plan usage policy](https://docs.qwencloud.com/token-plan/token-plan-permissions-and-usage). If the plan runs out of credits, check its usage and quota. For a request rate limit, wait before retrying.

See [QwenCloud API keys](https://docs.qwencloud.com/developer-guides/administration/api-keys) and [Token Plan models and errors](https://docs.qwencloud.com/token-plan/token-plan-faq).

## DeepSeek, Moonshot AI and Kimi For Coding

1. Select **Add provider** and choose **DeepSeek** for a DeepSeek API key, **Moonshot AI** for an international Kimi API Platform key, or **Kimi For Coding** for a key from the Kimi Code Console. VERA fills in the matching base URL.
2. Enter the service's key. For DeepSeek and Moonshot AI, select **Discover models** or enter the exact model ID. For Kimi For Coding, enter an ID such as `kimi-for-coding` or `k3-256k`, depending on your membership.
3. Select **Save**, then **Test**. For Kimi For Coding, **Reachability** is skipped and **Authentication and model** checks the key and model through inference.

Use the exact Kimi For Coding model ID. Kimi Code may answer a mistyped ID with a fallback model. A passing probe leaves capabilities for unverified Kimi IDs unknown.

DeepSeek Flash, Moonshot AI's Kimi K3 and the two Kimi Code examples accept text and images in VERA. DeepSeek V4 Pro accepts text. Capabilities for other model IDs may be unverified.

See [DeepSeek model limits](https://api-docs.deepseek.com/api/list-models/), the [Moonshot Kimi K3 guide](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart) and [Kimi Code model configuration](https://www.kimi.com/code/docs/en/kimi-code/models).

## MiniMax and Z.AI

1. Select **Add provider** and choose **MiniMax API** for a pay-as-you-go key (`sk-api-`) or **MiniMax M Plan** for a subscription key (`sk-cp-`) from MiniMax. Both use the international Messages service.
2. Choose **Z.AI API** for a Standard API Key. The **Z.AI GLM Coding Plan** preset uses the dedicated international Coding Plan address. Use a Personal Coding Plan or Team Plan key only if Z.AI has authorized access from VERA. Z.AI limits plan use to supported tools, and VERA is absent from its published list. Check the key type in your account because some keys can use more than one address and billing depends on the key and route.
3. Pick a suggested model or enter the exact ID enabled for your account. Select **Save**, then **Test**. These presets check the key and model through inference, which can consume quota. Choose the saved model for your session or workbench.

`MiniMax-M3.1-Flash` and `glm-5.3-flash` handle text and images, support tool calls and offer reasoning levels. On MiniMax API, `MiniMax-M3` handles text and images and lets you turn reasoning on or off. `glm-5.3` handles text, supports tool calls and offers reasoning levels. Capabilities for other manually entered IDs remain unverified.

See [MiniMax key setup](https://platform.minimax.io/docs/guides/quickstart-preparation), [Z.AI key management](https://docs.z.ai/devpack/notice/api-key-management) and [Z.AI's supported tools](https://docs.z.ai/devpack/tool/others#supported-tools).

## Alibaba Cloud and Xiaomi MiMo

1. Choose **Alibaba Cloud Model Studio** for pay-as-you-go. Select the region from the Model Studio console, copy its **Workspace ID** (starting with `llm-`) and enter a key for that workspace.
2. Choose **Alibaba Cloud Coding Plan** for an international Coding Plan key (`sk-sp-`). Use its Singapore connection. QwenCloud Standard and Token Plan have their own presets and account keys.
3. Choose **Xiaomi MiMo API** for a real-time API key (`sk-`) on the global API endpoint. For **Xiaomi MiMo Token Plan**, use the China, Singapore or Europe region shown on your Token Plan page and its individual (`tp-`) or team (`ttp-`) key.
4. Select **Discover models** where available, or enter the exact chat model ID from your provider console. Select **Save**, then **Test**. The test uses the selected route and may consume quota. Choose a model in your session or workbench.

Try `qwen3.7-flash` on Model Studio, `qwen3.7-plus` on Coding Plan, or `mimo-v2.6-flash` on MiMo when enabled for your account. A catalog entry alone does not confirm account access. Capabilities for other manually entered IDs may be unverified. To switch regions or workspaces, add a provider with the new scope.

See [Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [Coding Plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq), [MiMo API](https://mimo.mi.com/docs/en-US/api/chat/openai-api-post), [MiMo Token Plan](https://mimo.mi.com/docs/tokenplan/subscription).

Use Alibaba Coding Plan in supported interactive coding tools under Alibaba’s usage policy. Use MiMo Token Plan for coding workflows under Xiaomi’s usage policy.

## Fireworks AI, Together AI, Groq and Cerebras

1. Select **Add provider** and choose the service and enter an API key from its own console. VERA fills in the service address and stores each connection’s key separately.
2. Select **Discover models**, or enter a full model ID and its limits. Keep the account prefix for Fireworks, such as `accounts/fireworks/models/glm-5p3-flash`. For a dedicated endpoint, copy its exact inference ID from the service.
3. Save and select **Test** to check your key and chosen model. Tool and image support appear when the catalog or the provider’s model documentation supplies them. Check the provider’s limits and model access for your account.

See the model lists for [Fireworks AI](https://fireworks.ai/models), [Together AI](https://docs.together.ai/docs/serverless/models), [Groq](https://console.groq.com/docs/models) and [Cerebras](https://inference-docs.cerebras.ai/models/overview).

## Hugging Face Inference Providers, NVIDIA NIM and Vercel AI Gateway

1. Select **Add provider** and choose the service and enter its key. Hugging Face requires a user access token with Inference Providers permission. NVIDIA NIM uses a key with NVIDIA Public API Endpoints access. Vercel uses an AI Gateway key.
2. Select **Discover models** and choose a model, or enter its complete ID and limits for a gated or account-specific model. Keep the namespace and slashes. For Hugging Face, keep a route suffix such as `owner/model:novita` if you choose an upstream explicitly.
3. Save and select **Test** to check the chosen model with your key. A catalog entry does not guarantee account access. If access fails, check the exact ID and grant or plan in the service before changing the connection.

VERA sends prompts to the service named in the model picker. [Hugging Face](https://huggingface.co/docs/inference-providers/index) and [Vercel](https://vercel.com/docs/ai-gateway/models-and-providers) route requests upstream. [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) runs the selected hosted model. The picker shows documented input and tool capabilities when available.

## LM Studio

1. Start the LM Studio server and load a model.
2. **Add provider**, **Provider** LM Studio. The address `http://localhost:1234` is filled in.
3. Select **Test connection**. VERA reads the server's conversation models; embedding models are left out.
4. Choose the connection’s model and select **Save**.
5. On the provider’s model list, open **Model settings** for a model. Use it to set the context window, output limit, reasoning, temperature and image support. Leaving an optional parameter empty uses the provider default.

An API key is optional for LM Studio.

## Ollama and other compatible endpoints

1. **Add provider**, **Provider** Ollama or **Other compatible provider**. For Ollama the **Base URL** `http://localhost:11434/v1` is filled in.
2. Enter an **Endpoint name**, the **Base URL** (an `http` or `https` address ending in `/v1`), the **Model** name as the server knows it, the **Context window (tokens)** and the **Maximum output (tokens)**.
3. Enter an **Endpoint API key** if the server needs one, or leave it empty.
4. Select **Save**.

Take the context window from the model's documentation or your server settings. A value that is too large leads to errors from the server; one that is too small makes VERA summarize history earlier than needed.

## Slow local models

A local model can take minutes to load or to read a long prompt. **Response timeout (s)** sets how long VERA waits for the first answer and then between parts of the answer, from 10 to 3600 seconds; it starts at 300. Reasoning that the server streams counts as an answer, so a model that keeps thinking is not stopped.

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
| **The model did not respond within … s.** | Raise **Response timeout (s)** for the connection, or check that the server is running |

See also [Troubleshooting](troubleshooting.md).
