import { createBuilder, createTempDir } from "broccoli-test-helper";
import * as fs from "fs";
import Rust from "../index";

QUnit.module("Rust", () => {
  QUnit.test("works with a Cargo.toml file", async (assert) => {
    const input = await createTempDir();
    input.write({
      "Cargo.toml": `
[package]
name = "hello_lib"
version = "0.1.0"
authors = ["Kris Selden <kris.selden@gmail.com>"]

[lib]
crate-type = ["cdylib"]

[dependencies]
`,
      "src": {
        "a.rs": `
#[no_mangle]
pub fn fibonacci(x: f64) -> f64 {
  if x <= 2.0 {
    return 1.0;
  } else {
    return fibonacci(x - 1.0) + fibonacci(x - 2.0);
  }
}`,
      "lib.rs": `
#![feature(lang_items)]
#![no_std]

#[lang = "panic_fmt"]
#[no_mangle]
pub extern fn panic_fmt() -> ! { loop {} }

pub mod a;`,
      },
    });
    try {
      const plugin = new Rust(input.path());
      const output = createBuilder(plugin);
      try {
        await output.build();

        assert.deepEqual(output.changes(), {
          "hello_lib.wasm": "create",
        });
        const buffer = fs.readFileSync(output.path("hello_lib.wasm"));
        const mod = new WebAssembly.Module(buffer);
        const instance = new WebAssembly.Instance(mod, {});
        assert.strictEqual(instance.exports.fibonacci(20), 6765);
      } finally {
        output.dispose();
      }
    } finally {
      input.dispose();
    }
  });

  QUnit.test("works with a entry file", async (assert) => {
    const input = await createTempDir();
    input.write({
      "a.rs": `
#[no_mangle]
pub fn fibonacci(x: f64) -> f64 {
  if x <= 2.0 {
    return 1.0;
  } else {
    return fibonacci(x - 1.0) + fibonacci(x - 2.0);
  }
}`,
      "lib.rs": `
#![feature(lang_items)]
#![no_std]

#[lang = "panic_fmt"]
#[no_mangle]
pub extern fn panic_fmt() -> ! { loop {} }

pub mod a;`,
    });
    try {
      const plugin = new Rust(input.path(), {
        entry: "lib.rs",
      });
      const output = createBuilder(plugin);
      try {
        await output.build();

        assert.deepEqual(output.changes(), {
          "lib.wasm": "create",
        });
        const buffer = fs.readFileSync(output.path("lib.wasm"));
        const mod = new WebAssembly.Module(buffer);
        const instance = new WebAssembly.Instance(mod, {});
        assert.strictEqual(instance.exports.fibonacci(20), 6765);
      } finally {
        output.dispose();
      }
    } finally {
      input.dispose();
    }
  });
});

declare const WebAssembly: any;
