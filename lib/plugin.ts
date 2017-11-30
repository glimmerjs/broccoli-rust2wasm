import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const parseToml: (s: string) => any = require("toml").parse;

export const Plugin: PluginStatic = require("broccoli-plugin");

export interface RustPluginOptions {
  entry?: string;
  generateWrapper?: boolean;
}

export default class RustPlugin extends Plugin {
  private entry: string | undefined;
  private debug: boolean;
  private generateWrapper: boolean;

  constructor(input: any, options?: RustPluginOptions) {
    super([input]);
    this.debug = process.env.NODE_ENV !== "production";
    this.entry = options && options.entry;
    this.generateWrapper = options !== undefined && options.generateWrapper === true;
  }

  public build() {
    const { name, wasm} = this.compile();
    if (this.generateWrapper) {
      const outputFile = path.join(this.outputPath, `${name}.js`);
      fs.writeFileSync(outputFile, this.wrapper(wasm));
    } else {
      const outputFile = path.join(this.outputPath, `${name}.wasm`);
      fs.writeFileSync(outputFile, wasm);
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
    return `const toBuffer = typeof Buffer === 'undefined' ? (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0)) : (str) => Buffer.from(str, 'base64');
const mod = new WebAssembly.Module(toBuffer("${buffer.toString("base64")}"));
export default (imports) => new WebAssembly.Instance(mod, imports).exports;
`;
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
