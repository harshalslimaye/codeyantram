# Web-fetch evaluation

The deterministic suite covers public-network policy, pinned socket lookup,
redirects, wire/decompression limits, MIME/charset handling, cancellation,
conversion, output budgeting, shared execution budgets, provider replay, CLI
display, all JEV configuration states, failure recovery, and client disconnects.
It uses native localhost connections and simulated provider HTTP responses.
No live JEV accuracy, answer quality, or cost savings are established by these tests.

## Reproducible selection evaluation

```sh
npm run evaluate:web-fetch
```

This defaults to offline oracle judgments and makes no model requests. The five
authored fixtures cover documentation, API references, tutorials, code examples,
irrelevant sections, prerequisites, caveats, and embedded instruction attempts.
Run from the repository root. To save machine-readable output without npm's banner:

```sh
node --import tsx packages/core/evaluations/web-fetch/run.ts > /tmp/web-fetch-evaluation.json
```

The initial offline run retained every required evidence string before and after
output bounding in all five cases. Serialized output measurements were:

| Fixture | Unfiltered bytes | Filtered bytes (approximately) | Evidence retained |
| --- | ---: | ---: | ---: |
| Documentation | 7,537 | 873 | 100% |
| API reference | 8,243 | 879 | 100% |
| Tutorial | 8,914 | 925 | 100% |
| Code example | 8,942 | 948 | 100% |
| Embedded instructions | 8,484 | 875 | 100% |

Filtered bytes vary slightly with serialized duration. These are synthetic
selection-mechanics results using known labels, not measured JEV classification
accuracy or provider token savings. The 0.05 discard cutoff is conservative and
provisional. Keep JEV disabled by default until live evaluation supports a benefit.

## Opt-in live comparisons

Configure TypeSafe through `/connect` and explicitly enable `/jev` before running
live evaluation. This runner checks the saved preference and never changes it.
It sends only the authored fixtures and their objectives; it does not fetch
private pages or include conversation history. Live mode incurs provider charges.

```sh
# Live JEV relevance, retention, usage, and latency:
npm run evaluate:web-fetch -- --live

# Also compare unfiltered and filtered answers with a configured coding model:
npm run evaluate:web-fetch -- --live --model=gpt-6.1-sol

# Add a local pricing file for estimated USD costs:
npm run evaluate:web-fetch -- --live --model=gpt-6.1-sol --pricing=/tmp/provider-rates.json
```

Pricing JSON accepts `chat` and `jev` objects containing `input` and `output` USD
per million tokens, plus `cachedInput` and `cacheWrite` where applicable. Supply
current provider rates; they are not hardcoded. Missing usage or rates produce
null costs. Costs are estimates from reported counts, not invoice measurements.
The runner reports each answer, literal coverage, an injection marker check,
source and bounded evidence retention, serialized tool-output bytes, per-provider
usage, JEV duration, answer duration, and total filtered-path estimated cost.
The answer comparison uses a fixed prompt and bounded source content for each
path. It measures JEV plus the answer call; it excludes the initial tool-selection
call and other conversation context. Report those costs separately for a full
interactive-session comparison.

Model comparisons make two coding calls per fixture. JEV makes at most four
batches per fixture, with the same batch/deadline limits used in production.

Review both answers manually for correct meaning, prerequisites, contradictions,
units, code completeness, citations, and unsupported assertions. Literal coverage
does not establish correctness. Include JEV cost and latency when comparing paths;
input reduction alone does not establish a net benefit. Repeat across models,
documents, ambiguous objectives, and repeated runs before changing the cutoff.

Live evaluation was not run during implementation because the user's saved JEV
preference was disabled. That preference remains unchanged. Production fetching
and failure behavior are validated with deterministic tests; live quality and
cost validation remain an explicit rollout check.
