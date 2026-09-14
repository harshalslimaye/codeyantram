import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTreeSitterClient, type TreeSitterClient } from '@opentui/core';

// @opentui/core@0.5.9's compiled entry actually executes from Bun's global
// package cache (~/.bun/install/cache/@opentui/core@<version>@@@N/chunk-*.js),
// which has no node_modules of its own next to it. Its tree-sitter worker
// resolves its own assets (bundled grammar wasm, worker script) and
// web-tree-sitter's runtime wasm relative to that location by default, so
// without an override initialize() always rejects with "Cannot find module
// 'web-tree-sitter/tree-sitter.wasm'" - confirmed by tracing the failure
// through OpenTUI's tree-sitter reference docs and source.
//
// OTUI_ASSET_ROOT (documented at https://opentui.com/docs/reference/tree-sitter)
// relocates asset resolution to a directory shaped like a node_modules root
// (it looks up "<root>/@opentui/core/..."). Pointing it at the project's own
// node_modules - where @opentui/core sits next to a working web-tree-sitter -
// fixes it. Computed at runtime via import.meta.resolve rather than
// hardcoded, since Bun's node_modules/.bun/@opentui+core@<hash> directory
// name isn't stable across installs or machines.
//
// Resolves the package's main entry ('@opentui/core'), not '@opentui/core/package.json' -
// Bun's import.meta.resolve() allows that subpath regardless of the package's own exports
// map, but Node's doesn't: @opentui/core's package.json declares an "exports" map with no
// "./package.json" entry, so Node throws ERR_PACKAGE_PATH_NOT_EXPORTED for it. The main
// entry ('.') sits at the same directory depth (.../@opentui/core/index.<node|bun>.js,
// right alongside package.json), so the same three dirname() calls still land on the
// right node_modules root either way - runtime-agnostic without needing an OTUI_ASSET_ROOT
// override that itself differs by runtime.
function resolveAssetRoot(): string {
    const coreEntryPath = fileURLToPath(import.meta.resolve('@opentui/core'));
    // index.<node|bun>.js -> .../@opentui/core -> .../@opentui -> the node_modules root
    return dirname(dirname(dirname(coreEntryPath)));
}

if (process.env.OTUI_ASSET_ROOT === undefined) {
    process.env.OTUI_ASSET_ROOT = resolveAssetRoot();
}

// @opentui/core@0.5.9 only bundles wasm grammars for JS/JSX/TS/TSX/Markdown/Zig
// (see its assets/ directory). Everything else falls back to unstyled text,
// which is fine, but popular languages in coding responses are worth real
// highlighting. The official tree-sitter-<lang> npm packages (published by
// the tree-sitter org itself, https://tree-sitter.github.io/tree-sitter/)
// each bundle both a prebuilt .wasm grammar and its queries/highlights.scm -
// no local compiler/emscripten toolchain, no third-party grammar bundle
// needed. Paths resolved the same way as OTUI_ASSET_ROOT above: at runtime,
// not hardcoded.
function grammarAssetPath(packageName: string, relativePath: string): string {
    return fileURLToPath(import.meta.resolve(`${packageName}/${relativePath}`));
}

let extraGrammarsRegistered = false;

function registerExtraGrammars(client: TreeSitterClient): void {
    if (extraGrammarsRegistered) return;
    extraGrammarsRegistered = true;

    client.addFiletypeParser({
        filetype: 'html',
        aliases: ['htm'],
        wasm: grammarAssetPath('tree-sitter-html', 'tree-sitter-html.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-html', 'queries/highlights.scm')],
            injections: [grammarAssetPath('tree-sitter-html', 'queries/injections.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'bash',
        aliases: ['sh', 'shell', 'zsh'],
        wasm: grammarAssetPath('tree-sitter-bash', 'tree-sitter-bash.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-bash', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'python',
        aliases: ['py'],
        wasm: grammarAssetPath('tree-sitter-python', 'tree-sitter-python.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-python', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'json',
        wasm: grammarAssetPath('tree-sitter-json', 'tree-sitter-json.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-json', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'css',
        wasm: grammarAssetPath('tree-sitter-css', 'tree-sitter-css.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-css', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'go',
        aliases: ['golang'],
        wasm: grammarAssetPath('tree-sitter-go', 'tree-sitter-go.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-go', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'rust',
        aliases: ['rs'],
        wasm: grammarAssetPath('tree-sitter-rust', 'tree-sitter-rust.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-rust', 'queries/highlights.scm')],
            injections: [grammarAssetPath('tree-sitter-rust', 'queries/injections.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'c',
        wasm: grammarAssetPath('tree-sitter-c', 'tree-sitter-c.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-c', 'queries/highlights.scm')],
        },
    });

    // tree-sitter-cpp's own highlights.scm is deliberately minimal - just the
    // C++-specific additions (namespaced calls, templates, etc). C++ extends
    // C at the grammar level, so full coverage needs C's highlights.scm
    // layered underneath, same as editors that support both do it.
    client.addFiletypeParser({
        filetype: 'cpp',
        aliases: ['c++', 'cxx', 'cc'],
        wasm: grammarAssetPath('tree-sitter-cpp', 'tree-sitter-cpp.wasm'),
        queries: {
            highlights: [
                grammarAssetPath('tree-sitter-c', 'queries/highlights.scm'),
                grammarAssetPath('tree-sitter-cpp', 'queries/highlights.scm'),
            ],
            injections: [grammarAssetPath('tree-sitter-cpp', 'queries/injections.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'java',
        wasm: grammarAssetPath('tree-sitter-java', 'tree-sitter-java.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-java', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'php',
        // tree-sitter-php ships two wasm builds: the plain one (php_only)
        // parses PHP-only source, this one also parses HTML mixed in around
        // <?php ?> tags - the shape most real-world PHP snippets are in.
        wasm: grammarAssetPath('tree-sitter-php', 'tree-sitter-php.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-php', 'queries/highlights.scm')],
            injections: [grammarAssetPath('tree-sitter-php', 'queries/injections.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'ruby',
        aliases: ['rb'],
        wasm: grammarAssetPath('tree-sitter-ruby', 'tree-sitter-ruby.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-ruby', 'queries/highlights.scm')],
        },
    });

    client.addFiletypeParser({
        filetype: 'csharp',
        aliases: ['cs', 'c-sharp', 'c_sharp'],
        wasm: grammarAssetPath('tree-sitter-c-sharp', 'tree-sitter-c_sharp.wasm'),
        queries: {
            highlights: [grammarAssetPath('tree-sitter-c-sharp', 'queries/highlights.scm')],
        },
    });
}

/**
 * The app-wide tree-sitter client used for `<markdown>`/`<code>` highlighting.
 * Always import this instead of calling `getTreeSitterClient()` directly, so
 * the OTUI_ASSET_ROOT fix and the extra grammar registrations above are
 * guaranteed to have run.
 */
export function getAppTreeSitterClient(): TreeSitterClient {
    const client = getTreeSitterClient();
    registerExtraGrammars(client);
    return client;
}
