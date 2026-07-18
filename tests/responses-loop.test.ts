import { describe, expect, it, vi } from "vitest";
import { ResponsesLoopError, runResponsesTurn } from "../lib/ai/responses-loop";

describe("Responses API continuation loop", () => {
  it("preserves call IDs and sends strict stage tools", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: "resp_1",
        model: "gpt-5.6-sol",
        output: [
          {
            type: "function_call",
            call_id: "call_courses",
            name: "list_courses",
            arguments: JSON.stringify({ sessionId: "session_1", studentId: "student_emily" })
          }
        ],
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 10 }
      })
      .mockResolvedValueOnce({
        id: "resp_2",
        model: "gpt-5.6-sol",
        output: [
          { type: "message", content: [{ type: "output_text", text: "Seven classes are ready." }] }
        ],
        usage: { inputTokens: 140, outputTokens: 40, cachedTokens: 30 }
      });
    const toolExecutor = vi.fn().mockResolvedValue({ courses: ["Algebra I"] });

    const result = await runResponsesTurn({
      client: { create },
      stage: "orientation",
      userInput: "Show what is coming up.",
      toolExecutor
    });

    expect(result.text).toBe("Seven classes are ready.");
    expect(result.trace.responseIds).toEqual(["resp_1", "resp_2"]);
    expect(result.trace.usage).toEqual({ inputTokens: 240, outputTokens: 60, cachedTokens: 40 });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "low", context: "current_turn" },
      store: false,
      text: { verbosity: "low" },
      parallel_tool_calls: true
    });
    const secondInput = create.mock.calls[1][0].input;
    expect(secondInput).toContainEqual(
      expect.objectContaining({ type: "function_call_output", call_id: "call_courses" })
    );
  });

  it("rejects a tool that is unavailable for the stage", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_bad",
      model: "gpt-5.6-sol",
      output: [
        {
          type: "function_call",
          call_id: "call_bad",
          name: "save_personal_plan",
          arguments: JSON.stringify({ sessionId: "session_1" })
        }
      ]
    });
    await expect(
      runResponsesTurn({
        client: { create },
        stage: "orientation",
        userInput: "Save it.",
        toolExecutor: vi.fn()
      })
    ).rejects.toBeInstanceOf(ResponsesLoopError);
  });

  it("fails closed on malformed model output", async () => {
    const cases = [
      {
        output: [{ type: "message", content: [] }],
        code: "MODEL_INVALID_OUTPUT"
      },
      {
        output: [{ type: "function_call", call_id: "", name: "list_courses", arguments: "{}" }],
        code: "MODEL_INVALID_OUTPUT"
      },
      {
        output: [{ type: "function_call", call_id: "call_1", name: "list_courses", arguments: "{" }],
        code: "TOOL_ARGUMENT_INVALID"
      },
      {
        output: [{ type: "function_call", call_id: "call_1", name: "list_courses", arguments: "{}" }],
        code: "TOOL_ARGUMENT_INVALID"
      }
    ];
    for (const testCase of cases) {
      await expect(
        runResponsesTurn({
          client: { create: vi.fn().mockResolvedValue({ id: "bad", model: "gpt-5.6-sol", output: testCase.output }) },
          stage: "orientation",
          userInput: "test",
          toolExecutor: vi.fn()
        })
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it("enforces the configured tool-round ceiling", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_loop",
      model: "gpt-5.6-sol",
      output: [{
        type: "function_call",
        call_id: "call_courses",
        name: "list_courses",
        arguments: JSON.stringify({ sessionId: "session_1", studentId: "student_emily" })
      }]
    });
    await expect(
      runResponsesTurn({
        client: { create },
        stage: "orientation",
        userInput: "loop",
        toolExecutor: vi.fn().mockResolvedValue({ ok: true }),
        maxRounds: 1
      })
    ).rejects.toMatchObject({ code: "TOOL_ROUND_LIMIT" });
  });
});
