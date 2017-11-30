import { createBuilder, createTempDir } from "broccoli-test-helper";
import * as fs from "fs";
import Rust from "../index";

QUnit.module("Rust", () => {
  QUnit.test("works with a entry file", async (assert) => {
    const input = await createTempDir();
    input.write({
"mylib.rs": `
#![feature(lang_items)]
#![no_std]

#[no_mangle]
pub fn fibonacci(x: f64) -> f64 {
  if x <= 2.0 {
    return 1.0;
  } else {
    return fibonacci(x - 1.0) + fibonacci(x - 2.0);
  }
}

#[lang = "panic_fmt"]
#[no_mangle]
pub extern fn panic_fmt() -> ! { loop {} }
      `,
    });
    try {
      const plugin = new Rust(input.path(), {
        entry: "mylib.rs",
      });
      const output = createBuilder(plugin);
      try {
        await output.build();

        assert.deepEqual(output.changes(), {
          "mylib.wasm": "create",
        });
        const buffer = fs.readFileSync(output.path("mylib.wasm"));
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
