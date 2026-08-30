import type { StyleDefinitionInput } from '@opentui/core';
import type { ThemeColors } from './theme';

// Tree-sitter capture names pulled from the queries OpenTUI actually bundles
// (assets/{javascript,typescript,markdown,markdown_inline}/highlights.scm)
// plus the extra grammars registered in tree-sitter-client.ts's
// registerExtraGrammars() - each one's own queries/highlights.scm, not
// guessed from a generic scheme. SyntaxStyle resolves an unregistered dotted
// variant (e.g. keyword.conditional.ternary, function.method.call,
// string.escape) by falling back toward its parent (-> keyword, -> function,
// -> string), and anything never registered at all just renders unstyled
// rather than erroring - so this only needs to cover the token groups worth
// distinguishing, not every capture name each grammar defines.
export function buildSyntaxStyles(colors: ThemeColors): Record<string, StyleDefinitionInput> {
    return {
        keyword: { fg: colors.focus },
        // CSS at-rule names - top-level capture names, not dotted under
        // `keyword`, so they don't inherit its style via fallback.
        charset: { fg: colors.focus },
        import: { fg: colors.focus },
        keyframes: { fg: colors.focus },
        media: { fg: colors.focus },
        namespace: { fg: colors.focus },
        supports: { fg: colors.focus },

        string: { fg: colors.success },
        'markup.raw': { fg: colors.success },
        // JSON object keys - distinguishes {"key": "value"}'s two string roles.
        'string.special.key': { fg: colors.focus },
        // Escape sequences show up under two different capture names
        // depending on the grammar (plain `escape` in go/json/rust/ruby,
        // dotted `string.escape` in java/c#) - both explicit so the bold
        // treatment is consistent either way, rather than relying on
        // string.escape's fallback to plain (non-bold) `string`.
        escape: { fg: colors.success, bold: true },
        'string.escape': { fg: colors.success, bold: true },

        comment: { fg: colors.paths, dim: true },

        function: { fg: colors.accent },
        constructor: { fg: colors.accent },

        type: { fg: colors.accent, bold: true },
        module: { fg: colors.accent, bold: true },

        // HTML tags/attributes.
        tag: { fg: colors.accent },
        'tag.error': { fg: colors.error },
        attribute: { fg: colors.focus },

        'markup.heading': { fg: colors.focus, bold: true },
        'markup.strong': { fg: colors.text, bold: true },
        'markup.strikethrough': { fg: colors.del },
        'markup.link': { fg: colors.accent, underline: true },
    };
}
