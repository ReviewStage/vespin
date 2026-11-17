// mermaid-source.d.ts -- Mermaid's one-file build as the app reads it: its words, which the app's Babel config hands over as the module's value rather than running them (`apps/mobile/babel.config.js`), for the diagrams' sealed page to run.

declare module "mermaid/dist/mermaid.min.js" {
  const source: string;
  export default source;
}
