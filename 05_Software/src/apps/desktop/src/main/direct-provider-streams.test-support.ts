type StreamTarget = { messages: boolean; model: string };

function sse(events: string[]) {
  return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
}
function completions(deltas: object[], finish = "stop") {
  return sse([
    ...deltas.map(
      (delta, index) =>
        "data: " +
        JSON.stringify({
          id: "fixture",
          choices: [{ index: 0, delta, finish_reason: index === deltas.length - 1 ? finish : null }],
        }) +
        "\n\n",
    ),
    "data: [DONE]\n\n",
  ]);
}
function messages(blocks: { type: string }[], model: string, toolUse = false) {
  const stop = toolUse ? "tool_use" : "end_turn";
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    ...blocks,
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 12 },
    },
    { type: "message_stop" },
  ];
  return sse(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
}

const blockStart = (index: number, content_block: object) => ({
  type: "content_block_start",
  index,
  content_block,
});
const blockDelta = (index: number, delta: object) => ({ type: "content_block_delta", index, delta });
const blockStop = (index: number) => ({ type: "content_block_stop", index });

export function answer(service: StreamTarget) {
  return service.messages
    ? messages(
        [
          blockStart(0, { type: "text", text: "" }),
          blockDelta(0, { type: "text_delta", text: "Echo " }),
          blockDelta(0, { type: "text_delta", text: "received." }),
          blockStop(0),
        ],
        service.model,
      )
    : completions([{ content: "Echo " }, { content: "received." }]);
}

export function toolCall(service: StreamTarget, signature?: string) {
  return service.messages
    ? messages(
        [
          blockStart(0, { type: "thinking", thinking: "", signature: "" }),
          blockDelta(0, { type: "thinking_delta", thinking: "Prepare " }),
          blockDelta(0, { type: "thinking_delta", thinking: "the echo." }),
          ...(signature ? [blockDelta(0, { type: "signature_delta", signature })] : []),
          blockStop(0),
          blockStart(1, { type: "tool_use", id: "call_echo", name: "echo", input: {} }),
          blockDelta(1, { type: "input_json_delta", partial_json: '{"text":"OK"}' }),
          blockStop(1),
        ],
        service.model,
        true,
      )
    : completions(
        [
          { reasoning_content: "Prepare " },
          { reasoning_content: "the echo." },
          {
            tool_calls: [
              {
                index: 0,
                id: "call_echo",
                type: "function",
                function: { name: "echo", arguments: '{"text":"OK"}' },
              },
            ],
          },
        ],
        "tool_calls",
      );
}
