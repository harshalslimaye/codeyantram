const {parseForESLint} = /** @type {{parseForESLint: (source: string, options: object) => unknown}} */ (require('@babel/eslint-parser'));

// Imported files need a parser because Oxlint's JS-plugin parser API cannot
// parse additional files. Babel handles TypeScript without a compiler dependency.
/** @param {string} source @param {{filePath?: string}} [options] */
exports.parseForESLint = (source, options = {}) => parseForESLint(source, {
  ...options,
  requireConfigFile: false,
  babelOptions: {
    babelrc: false,
    configFile: false,
    plugins: [[require.resolve('@babel/plugin-syntax-typescript'), {
      isTSX: /\.[jt]sx$/.test(options.filePath ?? ''),
      dts: /\.d\.[cm]?ts$/.test(options.filePath ?? ''),
    }]],
  },
});
