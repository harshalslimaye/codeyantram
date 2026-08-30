import { describe, expect, test } from "bun:test";
import {
    DEFAULT_CHAT_MODEL_ID,
    PROVIDER_ENV_VARS,
    SUPPORTED_CHAT_MODELS,
    SUPPORTED_PROVIDERS,
    findSupportedChatModel,
    isModelAvailable,
    modelHasEffortControl,
    modelSupportsEffort,
} from "../src/models";

describe("findSupportedChatModel", () => {
    test("finds a known model by id", () => {
        expect(findSupportedChatModel("claude-sonnet-5")?.provider).toBe("anthropic");
    });

    test("returns undefined for an unknown id", () => {
        expect(findSupportedChatModel("not-a-real-model")).toBeUndefined();
    });
});

describe("DEFAULT_CHAT_MODEL_ID", () => {
    test("resolves to a model that actually exists in the catalog", () => {
        expect(findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)).toBeDefined();
    });
});

describe("modelHasEffortControl", () => {
    test("is false for claude-haiku-4-5, which rejects the effort parameter", () => {
        const haiku = findSupportedChatModel("claude-haiku-4-5")!;
        expect(modelHasEffortControl(haiku)).toBe(false);
    });

    test("is true for models that declare supported effort levels", () => {
        const sonnet = findSupportedChatModel("claude-sonnet-5")!;
        expect(modelHasEffortControl(sonnet)).toBe(true);
    });
});

describe("modelSupportsEffort", () => {
    test("is true for a level the model declares", () => {
        const opus = findSupportedChatModel("claude-opus-5")!;
        expect(modelSupportsEffort(opus, "max")).toBe(true);
    });

    test("is false for a level the model does not declare", () => {
        const gemini = findSupportedChatModel("gemini-3.5-flash")!;
        expect(modelSupportsEffort(gemini, "max")).toBe(false);
        expect(modelSupportsEffort(gemini, "xhigh")).toBe(false);
    });

    test("is false for every level on a model with no effort control", () => {
        const haiku = findSupportedChatModel("claude-haiku-4-5")!;
        const allLevels: Array<Parameters<typeof modelSupportsEffort>[1]> = [
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        ];

        for (const level of allLevels) {
            expect(modelSupportsEffort(haiku, level)).toBe(false);
        }
    });
});

describe("isModelAvailable", () => {
    test("is true when the model's provider has a key configured", () => {
        const sonnet = findSupportedChatModel("claude-sonnet-5")!;
        expect(isModelAvailable(sonnet, ["anthropic"])).toBe(true);
    });

    test("is false when the model's provider is not configured", () => {
        const gpt = findSupportedChatModel("gpt-5.4")!;
        expect(isModelAvailable(gpt, ["anthropic"])).toBe(false);
    });

    test("is false for every model when nothing is configured", () => {
        for (const model of SUPPORTED_CHAT_MODELS) {
            expect(isModelAvailable(model, [])).toBe(false);
        }
    });
});

describe("PROVIDER_ENV_VARS", () => {
    test("names a variable for every supported provider", () => {
        for (const provider of SUPPORTED_PROVIDERS) {
            expect(PROVIDER_ENV_VARS[provider]).toBeTruthy();
        }
    });

    test("every provider used by the catalog is covered", () => {
        for (const model of SUPPORTED_CHAT_MODELS) {
            expect(SUPPORTED_PROVIDERS).toContain(model.provider);
        }
    });
});

describe("SUPPORTED_CHAT_MODELS catalog invariants", () => {
    test("every model id is unique", () => {
        const ids = SUPPORTED_CHAT_MODELS.map(model => model.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("every defaultEffortLevel is itself one of the model's supportedEffortLevels", () => {
        for (const model of SUPPORTED_CHAT_MODELS) {
            if ("defaultEffortLevel" in model) {
                expect(model.supportedEffortLevels).toContain(model.defaultEffortLevel);
            }
        }
    });

    test("a model with no supported effort levels declares no default", () => {
        for (const model of SUPPORTED_CHAT_MODELS) {
            if (model.supportedEffortLevels.length === 0) {
                expect("defaultEffortLevel" in model).toBe(false);
            }
        }
    });
});
