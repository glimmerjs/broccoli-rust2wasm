import { execFileSync } from "child_process";
import describeWasm from "describe-wasm";
import * as fs from "fs";
import * as path from "path";

const parseToml: (s: string) => any = require("toml").parse;

export const Plugin: PluginStatic = require("broccoli-plugin");

export interface RustPluginOptions {
  entry?: string;
  generateWrapper?: boolean;
  generateAsyncWrapper?: boolean;
  generateTypescript?: boolean;
}

export default class RustPlugin extends Plugin {
  private entry: string | undefined;
  private debug: boolean;
  private generateWrapper: boolean;
  private generateAsyncWrapper: boolean;
  private generateTypescript: boolean;

  constructor(input: any, options?: RustPluginOptions) {
    super([input]);
    this.debug = process.env.NODE_ENV !== "production";
    this.entry = options && options.entry;
    this.generateWrapper = options !== undefined && options.generateWrapper === true;
    this.generateAsyncWrapper = options !== undefined && options.generateAsyncWrapper === true;
    this.generateTypescript = options !== undefined && options.generateTypescript === true;
  }

  public build() {
    const { name, wasm } = this.compile();
    const wasmGc = this.wasmGc(wasm);
    const wasmGcOpt = this.debug ? wasmGc : this.wasmOpt(wasmGc);
    if (this.generateWrapper || this.generateAsyncWrapper) {
      const outputFile = path.join(this.outputPath, `${name}.js`);
      fs.writeFileSync(outputFile, this.wrapper(wasmGcOpt));

      if (this.generateTypescript) {
        const typescriptFile = path.join(this.outputPath, `${name}.d.ts`);
        fs.writeFileSync(typescriptFile, this.typescript(wasmGcOpt));
      }
    } else {
      const outputFile = path.join(this.outputPath, `${name}.wasm`);
      fs.writeFileSync(outputFile, wasmGcOpt);
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
    const toBuffer = `const toBuffer = typeof Buffer === 'undefined' ? (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0)) : (str) => Buffer.from(str, 'base64');`;
    const deserialized = `toBuffer("${buffer.toString("base64")}")`;
    if (this.generateAsyncWrapper) {
      return `${toBuffer}
export default (imports) => {
  return WebAssembly.compile(${deserialized})
      .then((mod) => WebAssembly.instantiate(mod, imports))
      .then((m) => m.exports)
}`;
    } else {
      return `${toBuffer}
const mod = new WebAssembly.Module(${deserialized});
export default (imports) => new WebAssembly.Instance(mod, imports).exports;`;
    }
  }

  protected wasmGc(wasm: Buffer): Buffer {
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
  protected wasmOpt(wasm: Buffer): Buffer {
    const temp1 = path.join(this.cachePath, `opt-input.wasm`);
    const temp2 = path.join(this.cachePath, `opt-output.wasm`);
    fs.writeFileSync(temp1, wasm);
    try {
      execFileSync(`wasm-opt`, [`-Os`, temp1, `-o`, temp2]);
    } catch (err) {
      if (err.code === "ENOENT") {
        return wasm;
      }
      throw err;
    }
    return fs.readFileSync(temp2);
  }

  protected typescript(wasm: Buffer): string {
    const parsed = describeWasm(wasm);

    let imports = `export interface FunctionImports {\n`;
    let importedFunctions = 0;
    for (const imp of parsed.imports) {
      if (imp.kind !== "Function") {
        continue;
      }
      importedFunctions += 1;
      if (imp.module !== "env") {
        continue;
      }
      const signature = parsed.signatures[imp.signature];
      imports += `  ${imp.name}(`;
      for (let j = 0; j < signature.params.length; j++) {
        if (j > 0) {
          imports += `, `;
        }
        imports += `arg${j}: ${this.wasmTypeToTypescript(signature.params[j])}`;
      }
      imports += `): ${this.wasmTypeToTypescript(signature.return)};\n`;
    }
    imports += `}\n`;

    imports += `
export interface Imports {
  env: FunctionImports;
}`;

    let exports = `export interface Exports {\n`;
    for (const exp of parsed.exports) {
      if (exp.kind === "Memory") {
        exports += `  ${exp.name}: WebAssembly.Memory;\n`;
        continue;
      }
      if (exp.kind !== "Function") {
        continue;
      }
      const func = parsed.functions[exp.index - importedFunctions];
      const signature = parsed.signatures[func];
      exports += `  ${exp.name}(`;
      for (let j = 0; j < signature.params.length; j++) {
        if (j > 0) {
          exports += `, `;
        }
        exports += `arg${j}: ${this.wasmTypeToTypescript(signature.params[j])}`;
      }
      exports += `): ${this.wasmTypeToTypescript(signature.return)};\n`;
    }
    exports += `}`;

    const ret = this.generateAsyncWrapper ? `Promise<Exports>` : `Exports`;

    return `
${imports}

${exports}

declare const Mod: (imports: Imports) => ${ret};

export default Mod;
`;
  }

  protected wasmTypeToTypescript(ty: string): string {
    if (ty === "i32" || ty === "i64" || ty === "f32" || ty === "f64") {
      return "number";
    }
    if (ty === "void") {
      return "void";
    }
    throw new Error(`unknown wasm type: ${ty}`);
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
