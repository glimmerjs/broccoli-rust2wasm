import { execFileSync } from "child_process";
import * as path from "path";

export const Plugin: PluginStatic = require("broccoli-plugin");

export interface RustPluginOptions {
  entry: string;
}

export default class RustPlugin extends Plugin {
  private entry: string;

  constructor(input: any, options: RustPluginOptions) {
    super([input]);
    this.entry = options.entry;
  }

  public build() {
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
