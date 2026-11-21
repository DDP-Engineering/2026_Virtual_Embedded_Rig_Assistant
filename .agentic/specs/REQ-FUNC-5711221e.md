# Hugging Face, NVIDIA NIM and Vercel AI Gateway catalogs

Each binding uses bearer authentication and the existing bounded, redirect-refusing discovery.
The installed pi-ai version confirms the Hugging Face and NVIDIA OpenAI Completions bases. Its
Vercel adapter uses Anthropic Messages. VERA uses the separately documented OpenAI-compatible
Vercel route through the shared Completions adapter.

| Service | GET model catalog | POST inference |
| --- | --- | --- |
| Hugging Face Inference Providers | `https://router.huggingface.co/v1/models` | `https://router.huggingface.co/v1/chat/completions` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1/models` | `https://integrate.api.nvidia.com/v1/chat/completions` |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1/models` | `https://ai-gateway.vercel.sh/v1/chat/completions` |

- Hugging Face lists chat models. Keep the complete IDs and declared text/image inputs, and
  exclude entries whose routes all report errors. For automatic routing, show tool support
  only when all eligible routes are confirmed live and agree. Report their smallest context
  window when each confirms one. A route suffix stays part of a manually saved ID.
- NVIDIA hosts models directly. Its catalog mixes sparse entries for multiple tasks. Include
  explicitly typed chat models and exact IDs known in pi-ai's pinned NVIDIA chat metadata.
  Native context, tool and thinking fields take precedence. A vision-language classification
  supplies text and image input. Exact documented model evidence fills supported gaps.
  Unclassified IDs remain manual.
- Vercel routes language models through AI Gateway. Use catalog model type, names, limits,
  modalities and positive capability signals. The scoped key can add team-specific models.
  Catalog visibility is independent of actual access to any of the three services.
- Missing, invalid or empty discovery leaves the explicitly saved model in place. Manual
  IDs and discovery IDs remain opaque to VERA. The selected account, route and ID stay
  fixed when the service denies access or reports the model missing.

Primary references:

- [Hugging Face Hub API](https://huggingface.co/docs/inference-providers/hub-api) and
  [function calling](https://huggingface.co/docs/inference-providers/guides/function-calling)
- [NVIDIA hosted model catalog](https://docs.nvidia.com/nemo-helix/latest/documentation/models-and-inference)
  and its [Muse Glimmer](https://docs.api.nvidia.com/nim/reference/meta-muse-glimmer-30b-infer)
  and [Kimi K3.1 Pro](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3_1-pro) API documentation
- [Vercel REST model list](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api#get-models) and
  [Chat Completions](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions)
