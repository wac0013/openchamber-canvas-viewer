import { build } from "esbuild";

// Quatro artefatos:
// - server/main.js  → servidor único (ESM, Node; sobe sozinho a partir do serviço);
// - panel/main.js   → bundle IIFE (o painel roda num iframe sandboxado);
// - service/main.js → bundle ESM (o host roda em Node com ELECTRON_RUN_AS_NODE); embute o SDK
//   para a extensão não depender de node_modules no destino;
// - plugin/index.js → plugin do OpenCode (ESM; o OpenCode o carrega com import() puro,
//   sem node_modules ao lado, por isso tudo é embutido e só "node:*" fica externo).
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: "panel/main.js",
  logLevel: "info",
});

await build({
  entryPoints: ["service/main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "service/main.js",
  logLevel: "info",
});

await build({
  entryPoints: ["plugin/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "plugin/index.js",
  logLevel: "info",
});

await build({
  entryPoints: ["server/main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "server/main.js",
  logLevel: "info",
});
