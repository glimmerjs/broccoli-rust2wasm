import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const parseToml: (s: string) => any = require("toml").parse;

export const Plugin: PluginStatic = require("broccoli-plugin");

export interface RustPluginOptions {
  entry?: string;
  generateWrapper?: boolean;
  generateAsyncWrapper?: boolean;
}

export default class RustPlugin extends Plugin {
  private entry: string | undefined;
  private debug: boolean;
  private generateWrapper: boolean;
  private generateAsyncWrapper: boolean;

  constructor(input: any, options?: RustPluginOptions) {
    super([input]);
    this.debug = process.env.NODE_ENV !== "production";
    this.entry = options && options.entry;
    this.generateWrapper = options !== undefined && options.generateWrapper === true;
    this.generateAsyncWrapper = options !== undefined && options.generateAsyncWrapper === true;
  }

  public build() {
    const { name, wasm } = this.compile();
    let wasm_gc = this.wasm_gc(wasm);
    let wasm_gc_opt = this.debug ? wasm_gc : this.wasm_opt(wasm_gc);
    if (this.generateWrapper || this.generateAsyncWrapper) {
      const outputFile = path.join(this.outputPath, `${name}.js`);
      fs.writeFileSync(outputFile, this.wrapper(wasm_gc_opt));
    } else {
      const outputFile = path.join(this.outputPath, `${name}.wasm`);
      fs.writeFileSync(outputFile, wasm_gc_opt);
    }
  }

  protected compile(): CompileResult {
    if (this.entry) {
      return this.rust(this.entry);
    } else {
      return this.cargo();
    }
  }

  protected cargo(): CompileResult {
    const args = [
      "build",
      "--target", "wasm32-unknown-unknown"];
    let config = "debug";

    if (!this.debug) {
      config = "release";
      args.push("--release");
    }

    execFileSync("cargo", args, {
      cwd: this.inputPaths[0],
      env: Object.assign({}, process.env, {
        CARGO_TARGET_DIR: this.cachePath,
      }),
    });

    const name = this.crateName();
    const outputFile = path.join(this.cachePath, "wasm32-unknown-unknown", config, `${name}.wasm`);
    return {
      name,
      wasm: fs.readFileSync(outputFile),
    };
  }

  protected crateName() {
    return this.cargoConfig().package.name;
  }

  protected cargoConfig() {
    const configFile = path.join(this.inputPaths[0], "Cargo.toml");
    const config = fs.readFileSync(configFile, "utf8");
    return parseToml(config);
  }

  protected rust(inputFile: string): CompileResult {
    const name = path.basename(inputFile, ".rs");
    const outputFile = path.join(this.cachePath, `${name}.wasm`);

    const args = [ inputFile ];

    args.push("--target", "wasm32-unknown-unknown");
    args.push("--crate-type", "cdylib");

    if (this.debug) {
      args.push("-C", "debuginfo=2");
      // seems to be buggy < 1
      args.push("-C", "opt-level=1");
    } else {
      args.push("-C", "opt-level=3");
    }

    args.push("-o", outputFile);

    execFileSync(`rustc`, args, { cwd: this.inputPaths[0] });

    return {
      name,
      wasm: fs.readFileSync(outputFile),
    };
  }

  protected wrapper(buffer: Buffer) {
    // tslint:disable-next-line:max-line-length
    let toBuffer = `const toBuffer = typeof Buffer === 'undefined' ? (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0)) : (str) => Buffer.from(str, 'base64');`;
    let deserialized = `toBuffer("${buffer.toString("base64")}")`;
    if (this.generateAsyncWrapper) {
      return `${toBuffer}
export default async (imports) =>
  const mod = await WebAssembly.compile(${deserialized});
  return (await WebAssembly.instantiate(mod, imports)).exports;`;
    } else {
      return `${toBuffer}
const mod = new WebAssembly.Module(${deserialized});
export default (imports) => new WebAssembly.Instance(mod, imports).exports;`;
    }
  }

  protected wasm_gc(wasm: Buffer): Buffer {
    const temp1 = path.join(this.cachePath, `gc-input.wasm`);
    const temp2 = path.join(this.cachePath, `gc-output.wasm`);
    fs.writeFileSync(temp1, wasm);
    execFileSync(`wasm-gc`, [temp1, temp2]);
    return fs.readFileSync(temp2);
  }

  // Optionally run the `wasm-opt` binary from
  // https://github.com/WebAssembly/binaryen but it's not always installed
  // everywhere or easy to install so try to gracfully handle the case where it
  // can't be found and instead just skip this step.
  protected wasm_opt(wasm: Buffer): Buffer {
    const temp1 = path.join(this.cachePath, `opt-input.wasm`);
    const temp2 = path.join(this.cachePath, `opt-output.wasm`);
    fs.writeFileSync(temp1, wasm);
    try {
      execFileSync(`wasm-opt`, [`-Os`, temp1, `-o`, temp2]);
    } catch (err) {
      if (err.code == 'ENOENT')
        return wasm;
      throw err;
    }
    return fs.readFileSync(temp2);
  }
}

export interface CompileResult {
  name: string;
  wasm: Buffer;
}

export interface Plugin {
  inputPaths: string[];
  outputPath: string;
  cachePath: string;
}

export interface PluginStatic {
  prototype: Plugin;
  new (inputs: any[], options?: {
    annotation?: string;
    name?: string;
    persistentOutput?: boolean;
  }): Plugin;
}
