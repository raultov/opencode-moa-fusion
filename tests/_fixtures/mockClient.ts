import type {
  AssistantMessage,
  Config,
  OpencodeClient,
  Part,
  Session,
} from "@opencode-ai/sdk";

export type MockPart = { type: "text"; text: string } | Part;
export type MockPartArray = Array<MockPart>;

export type MockPromptBody = {
  agent?: string;
  model?: { providerID: string; modelID: string };
  system?: string;
  tools?: Record<string, boolean>;
  parts: Array<Part>;
};

export type MockPromptData = {
  info?: AssistantMessage;
  parts: MockPartArray;
};

export type MockModel = {
  id: string;
  providerID: string;
  api: { id: string; url: string; npm: string };
  name: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
    output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
  };
  cost: {
    input: number;
    output: number;
    cache: { read: number; write: number };
  };
  limit: { context: number; output: number };
  status: "alpha" | "beta" | "deprecated" | "active";
  options: Record<string, unknown>;
  headers: Record<string, string>;
};

export type MockProvider = {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "api";
  env: Array<string>;
  key?: string;
  options: Record<string, unknown>;
  models: Record<string, MockModel>;
};

export type MockProvidersResponse = {
  data?: { providers: MockProvider[]; default: Record<string, string> };
};

export type MockClient = OpencodeClient & {
  __spy: {
    createCalls: Array<{ body?: { parentID?: string; title?: string } }>;
    promptCalls: Array<{ path: { id: string }; body: MockPromptBody }>;
    deleteCalls: Array<{ path: { id: string } }>;
  };
  __script: {
    config: () => Promise<Config>;
    providers: () => Promise<MockProvidersResponse>;
    onPrompt: (
      sessionID: string,
      body: MockPromptBody,
    ) => Promise<MockPromptData> | Promise<never>;
  };
};

type CreateCallArgs = Parameters<OpencodeClient["session"]["create"]>[0];
type PromptCallArgs = Parameters<OpencodeClient["session"]["prompt"]>[0];

export function makeMockClient(script: Partial<MockClient["__script"]> = {}): MockClient {
  const createCalls: Array<{ body?: { parentID?: string; title?: string } }> = [];
  const promptCalls: Array<{ path: { id: string }; body: MockPromptBody }> = [];
  const deleteCalls: Array<{ path: { id: string } }> = [];

  const client = {
    __spy: {
      createCalls,
      promptCalls,
      deleteCalls,
    },
    __script: {
      config: script.config || (async () => ({}) as Config),
      providers:
        script.providers ||
        (async () => ({
          data: {
            providers: [
              {
                id: "openai",
                name: "openai",
                source: "config" as const,
                env: [],
                options: {},
                models: {
                  "gpt-4o-mini": {} as MockModel,
                  "gpt-4o": {} as MockModel,
                },
              },
              {
                id: "anthropic",
                name: "anthropic",
                source: "config" as const,
                env: [],
                options: {},
                models: {
                  "claude-3-5-sonnet": {} as MockModel,
                  "claude-3-5-haiku": {} as MockModel,
                },
              },
            ],
            default: {},
          },
        })),
      onPrompt:
        script.onPrompt ||
        (async () => {
          throw new Error("not implemented");
        }),
    },
    config: {
      get: async () => client.__script.config(),
      providers: async () => client.__script.providers(),
    },
    session: {
      create: async (args: CreateCallArgs) => {
        client.__spy.createCalls.push(
          args as unknown as { body?: { parentID?: string; title?: string } },
        );
        const session: Session = {
          id: `mock_session_${client.__spy.createCalls.length}`,
          projectID: "mock_project",
          directory: "/mock",
          title: "mock",
          version: "0",
          time: { created: Date.now(), updated: Date.now() },
        };
        return { data: session } as Awaited<
          ReturnType<OpencodeClient["session"]["create"]>
        >;
      },
      prompt: async (args: PromptCallArgs) => {
        client.__spy.promptCalls.push(
          args as unknown as { path: { id: string }; body: MockPromptBody },
        );
        const result = await client.__script.onPrompt(args.path.id, args.body as MockPromptBody);
        return { data: result, error: undefined } as unknown as Awaited<
          ReturnType<OpencodeClient["session"]["prompt"]>
        >;
      },
    },
  };
  return client as unknown as MockClient;
}
