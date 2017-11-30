import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const parseToml: (s: string) => any = require("toml").parse;

export const Plugin: PluginStatic = require("broccoli-plugin");

export interface RustPluginOptions {
  entry?: string;
}

export default class RustPlugin extends Plugin {
  private entry: string | undefined;

  constructor(input: any, options?: RustPluginOptions) {
    super([input]);
    this.entry = options && options.entry;
  }

  public build() {

    if (this.entry) {
      const inputFile = path.join(
        this.inputPaths[0], this.entry);

      const outputFile = path.join(
        this.outputPath,
        this.entry.replace(".rs", ".wasm"));

      execFileSync(`rustc`, [
        "--target", "wasm32-unknown-unknown",
        "-O",
        "--crate-type", "cdylib",
        "-o", outputFile,
        inputFile]);
    } else {
      const cargoToml = parseToml(
        fs.readFileSync(path.join(this.inputPaths[0], "Cargo.toml"), "utf8"));
      const packageName = cargoToml.package.name;
      execFileSync("cargo", [
        "build",
        "--target", "wasm32-unknown-unknown",
        "--release",
      ], {
        cwd: this.inputPaths[0],
        env: Object.assign({}, process.env, {
          CARGO_TARGET_DIR: this.cachePath,
        }),
      });
      fs.writeFileSync(path.join(this.outputPath, packageName + ".wasm"),
        fs.readFileSync(
          path.join(this.cachePath, "wasm32-unknown-unknown", "release", packageName + ".wasm")));
    }
  }
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
