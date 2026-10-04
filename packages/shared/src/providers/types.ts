export const SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
] as const;

export const EFFORT_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export type ProviderCredentials = Partial<Record<SupportedProvider, string>>;

export type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  supportedEffortLevels: readonly EffortLevel[];
  defaultEffortLevel?: EffortLevel;
  contextWindow: number;
};
