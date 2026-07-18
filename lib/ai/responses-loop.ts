import {
  getStageTools,
  isReadOnlyStage,
  type ToolStage,
  validateToolArguments
} from "./tool-registry";

export interface ModelResponse {
  id: string;
  model: string;
  output: Array<Record<string, unknown>>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
}

export interface ResponsesClient {
  create(payload: Record<string, unknown>): Promise<ModelResponse>;
}

export class ResponsesLoopError extends Error {
  constructor(readonly code: "MODEL_INVALID_OUTPUT" | "TOOL_NOT_ALLOWED" | "TOOL_ARGUMENT_INVALID" | "TOOL_ROUND_LIMIT", message: string) {
    super(message);
    this.name = "ResponsesLoopError";
  }
}

function extractText(output: Array<Record<string, unknown>>): string | null {
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    const text = item.content
      .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("");
    if (text) return text;
  }
  return null;
}

export async function runResponsesTurn(input: {
  client: ResponsesClient;
  stage: ToolStage;
  userInput: string;
  instructions?: string;
  responseFormat?: Record<string, unknown>;
  safetyIdentifier?: string;
  toolExecutor: (name: string, args: unknown) => Promise<unknown>;
  maxRounds?: number;
}) {
  const conversation: Array<Record<string, unknown>> = [
    { role: "user", content: input.userInput }
  ];
  const responseIds: string[] = [];
  const toolCalls: Array<{ name: string; callId: string }> = [];
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const maxRounds = input.maxRounds ?? 4;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await input.client.create({
      model: "gpt-5.6-sol",
      reasoning: { effort: "low", context: "current_turn" },
      store: false,
      text: { verbosity: "low", ...(input.responseFormat ? { format: input.responseFormat } : {}) },
      max_output_tokens: 500,
      tools: getStageTools(input.stage),
      tool_choice: "auto",
      parallel_tool_calls: isReadOnlyStage(input.stage),
      ...(input.instructions ? { instructions: input.instructions } : {}),
      ...(input.safetyIdentifier ? { safety_identifier: input.safetyIdentifier } : {}),
      input: conversation
    });
    responseIds.push(response.id);
    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;
    usage.cachedTokens += response.usage?.cachedTokens ?? 0;
    conversation.push(...response.output);

    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      const text = extractText(response.output);
      if (!text) throw new ResponsesLoopError("MODEL_INVALID_OUTPUT", "The model returned no final text.");
      return { text, trace: { responseIds, model: response.model, toolCalls, usage } };
    }

    const outputs = await Promise.all(
      calls.map(async (call) => {
        const name = typeof call.name === "string" ? call.name : "";
        const callId = typeof call.call_id === "string" ? call.call_id : "";
        if (!name || !callId) {
          throw new ResponsesLoopError("MODEL_INVALID_OUTPUT", "A function call omitted its name or call ID.");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof call.arguments === "string" ? call.arguments : "");
        } catch {
          throw new ResponsesLoopError("TOOL_ARGUMENT_INVALID", "Function arguments were not valid JSON.");
        }
        let validated: unknown;
        try {
          validated = validateToolArguments(input.stage, name, parsed);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool validation failed.";
          const code = /not allowed/i.test(message) ? "TOOL_NOT_ALLOWED" : "TOOL_ARGUMENT_INVALID";
          throw new ResponsesLoopError(code, message);
        }
        toolCalls.push({ name, callId });
        const result = await input.toolExecutor(name, validated);
        return { type: "function_call_output", call_id: callId, output: JSON.stringify(result) };
      })
    );
    conversation.push(...outputs);
  }
  throw new ResponsesLoopError("TOOL_ROUND_LIMIT", "The model exceeded the tool-round limit.");
}
