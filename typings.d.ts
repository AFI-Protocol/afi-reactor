// Ambient module declarations — the JUSTIFIED MINIMUM.
//
// An ambient `declare module` BEATS real module resolution: if a package is
// declared here, TypeScript binds every import of it to this declaration even
// when the real types resolve successfully. This file previously declared 16
// modules, 7 of them typing the whole afi-core boundary as `any`, which is why
// no compiler had ever checked that seam (D8).
//
// Everything else was removed because the package ships real types that this
// file was shadowing: afi-core (via its `exports` map, reached by
// moduleResolution "bundler"), ajv, ajv-formats, ccxt, trading-signals,
// telegram, node-telegram-bot-api, plus express via @types/express and the
// jest globals via @types/jest.
//
// DO NOT add a module here to silence a type error. If the package ships types,
// fix resolution; if it does not, install its @types package. Only a package
// with no types from any source belongs below.
//
// `input` (v1.0.1) ships no type declarations and has no @types package.
declare module "input" {
  const input: any;
  export = input;
}
