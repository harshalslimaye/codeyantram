// Values match the AI SDK's providerOptions keys exactly, so the server can build
// `providerOptions: { [model.provider]: ... }` without a translation table.
export const SUPPORTED_PROVIDERS = ["anthropic", "openai", "google", "deepseek", "openrouter"] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// The key each provider's AI SDK package reads. Shared because both sides need
// it for different halves of the same job: the server checks whether the key is
// set, and the CLI names the missing one when telling the user what to add.
export const PROVIDER_ENV_VARS: Record<SupportedProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
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

// Exported (not just used internally) so it can also describe an OpenRouter model -
// fetched live from OpenRouter's own catalog (see the server's openrouter-models module),
// never listed in SUPPORTED_CHAT_MODELS below. Both shapes are structurally identical;
// only where they come from differs. OpenRouter's own ids are already vendor-namespaced
// (e.g. "nvidia/nemotron-3.5-lightning:free"), so they can't collide with this catalog's
// bare ids ("claude-sonnet-5") - no dedicated collision-avoidance key was needed.
export type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    // Empty when the model rejects the effort parameter entirely (e.g. claude-haiku-4-5).
    supportedEffortLevels: readonly EffortLevel[];
    // What the provider applies when no effort is sent. Omitted when the model takes no effort.
    defaultEffortLevel?: EffortLevel;
    // The provider's own input ceiling, in tokens - system prompt, tool schemas, and every
    // message in the conversation must fit under this. Required (not optional) so the
    // catalog's `satisfies` check forces every model to carry a real figure rather than
    // letting one silently fall back to `undefined` and break the context-usage
    // calculation for just that model. Sourced from each provider's own docs, not
    // measured - a provider can move this number without notice.
    contextWindow: number;
};

export const SUPPORTED_CHAT_MODELS = [
    {
        id: "claude-sonnet-5",
        provider: "anthropic",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultEffortLevel: "high",
        // 1M tokens, standard - no beta header required. platform.claude.com/docs/en/build-with-claude/context-windows
        contextWindow: 1_000_000,
    },
    {
        id: "claude-opus-5",
        provider: "anthropic",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultEffortLevel: "high",
        // 1M tokens, standard - no beta header required. platform.claude.com/docs/en/build-with-claude/context-windows
        contextWindow: 1_000_000,
    },
    {
        id: "claude-haiku-4-5",
        provider: "anthropic",
        supportedEffortLevels: [],
        // platform.claude.com/docs/en/build-with-claude/context-windows
        contextWindow: 200_000,
    },
    {
        id: "gpt-5.4",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
        // developers.openai.com/api/docs/models/gpt-5.4
        contextWindow: 1_050_000,
    },
    {
        id: "gpt-5.4-mini",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
        // developers.openai.com/api/docs/models/gpt-5.4-mini
        contextWindow: 400_000,
    },
    {
        id: "gpt-5.4-nano",
        provider: "openai",
        supportedEffortLevels: ["none", "low", "medium", "high", "xhigh"],
        defaultEffortLevel: "none",
        // developers.openai.com/api/docs/models/gpt-5.4-nano
        contextWindow: 400_000,
    },
    {
        id: "gemini-3.5-flash",
        provider: "google",
        supportedEffortLevels: ["minimal", "low", "medium", "high"],
        defaultEffortLevel: "medium",
        // 1,048,576 tokens (2^20). deepmind.google/models/model-cards/gemini-3-5-flash
        contextWindow: 1_048_576,
    },
    {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        supportedEffortLevels: ["none", "low", "high", "max"],
        defaultEffortLevel: "high",
        // 1M tokens, default across official DeepSeek services - not independently verified
        // against a DeepSeek-owned page (their docs weren't reachable at lookup time);
        // corroborated by multiple third-party model cards. Re-check before relying on it
        // for anything more consequential than an approximate display.
        contextWindow: 1_048_576,
    },
    {
        id: "deepseek-v4-pro",
        provider: "deepseek",
        supportedEffortLevels: ["none", "low", "high", "max"],
        defaultEffortLevel: "high",
        // Same figure and same caveat as deepseek-v4-flash above.
        contextWindow: 1_048_576,
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

// Both take the wider SupportedChatModelDefinition (not SupportedChatModel) so they also
// accept a live-fetched OpenRouter model (see resolveChatModel on the server) - both
// shapes carry supportedEffortLevels, which is all either of these needs.

// Whether the model accepts an effort parameter at all (e.g. false for claude-haiku-4-5).
export function modelHasEffortControl(model: SupportedChatModelDefinition): boolean {
    return model.supportedEffortLevels.length > 0;
}

export function modelSupportsEffort(model: SupportedChatModelDefinition, effort: EffortLevel): boolean {
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
