// Jest transpiles the TypeScript sources with Babel (babel-jest), which does not depend on the TypeScript
// compiler: ts-jest needs the TypeScript JS API, which TypeScript 7 no longer ships. Types are checked by `tsc`.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }], "@babel/preset-typescript"],
};
