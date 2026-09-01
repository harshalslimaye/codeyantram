// Values match the AI SDK's providerOptions keys exactly, so the server can build
// `providerOptions: { [model.provider]: ... }` without a translation table.
export const SUPPORTED_PROVIDERS = ["anthropic", "openai", "google", "deepseek"] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// The key each provider's AI SDK package reads. Shared because both sides need
// it for different halves of the same job: the server checks whether the key is
// set, and the CLI names the missing one when telling the user what to add.
export const PROVIDER_ENV_VARS: Record<SupportedProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
};

// Every effort value any supported model accepts. No single provider supports
// all of these - each model declares its own subset below:
// - Anthropic (Opus 5 / Sonnet 5): low, medium, high, xhigh, max (no "none" - thinking has no off-switch at this level)
// - OpenAI (gpt-5.4 family):       none, low, medium, high, xhigh (no "max")
// - Google (Gemini 3.5 Flash):     minimal, low, medium, high (no "xhigh"/"max")
// - DeepSeek (V4 family):          none, low, high, max (no "minimal"/"medium"/"xhigh" - the
//   API's reasoningEffort field only accepts low/high/max, plus a separate on/off
//   toggle for "none"; see buildProviderOptions in the server for how that's built)
export const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    // Empty when the model rejects the effort parameter entirely (e.g. claude-haiku-4-5).
    supportedEffortLevels: readonly EffortLevel[];
    // What the provider applies when no effort is sent. Omitted when the model takes no effort.
    defaultEffortLevel?: EffortLevel;
};

export const SUPPORTED_CHAT_MODELS = [
    {
        id: "claude-sonnet-5",
        provider: "anthropic",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultEffortLevel: "high",
    },
    {
        id: "claude-opus-5",
        provider: "anthropic",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultEffortLevel: "high",
    },
    {
        id: "claude-haiku-4-5",
        provider: "anthropic",
        supportedEffortLevels: [],
    },
    {
        id: "gpt-5.4",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
    },
    {
        id: "gpt-5.4-mini",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
    },
    {
        id: "gpt-5.4-nano",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
    },
    {
        id: "gemini-3.5-flash",
        provider: "google",
        supportedEffortLevels: ["minimal", "low", "medium", "high"],
        defaultEffortLevel: "medium",
    },
    {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        supportedEffortLevels: ["none", "low", "high", "max"],
        defaultEffortLevel: "high",
    },
    {
        id: "deepseek-v4-pro",
        provider: "deepseek",
        supportedEffortLevels: ["none", "low", "high", "max"],
        defaultEffortLevel: "high",
    },
] as const satisfies SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

// Derived rather than re-listed, so it can never drift from the catalog above.
export const SUPPORTED_CHAT_MODEL_IDS: SupportedChatModelId[] = SUPPORTED_CHAT_MODELS.map(
    model => model.id,
);

export function findSupportedChatModel(modelId: string): SupportedChatModel | undefined {
    return SUPPORTED_CHAT_MODELS.find(model => model.id === modelId);
}

// Whether the model accepts an effort parameter at all (e.g. false for claude-haiku-4-5).
export function modelHasEffortControl(model: SupportedChatModel): boolean {
    return model.supportedEffortLevels.length > 0;
}

export function modelSupportsEffort(model: SupportedChatModel, effort: EffortLevel): boolean {
    return (model.supportedEffortLevels as readonly EffortLevel[]).includes(effort);
}

// A model is only usable if its provider's key is actually set, which is
// runtime state the server reports (see providersResponseSchema) rather than
// anything this catalog can know on its own.
export function isModelAvailable(
    model: SupportedChatModel,
    configuredProviders: readonly SupportedProvider[],
): boolean {
    return configuredProviders.includes(model.provider);
}

// Named explicitly (not SUPPORTED_CHAT_MODELS[0].id) so reordering the list above can't silently change the default.
export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-sonnet-5";
