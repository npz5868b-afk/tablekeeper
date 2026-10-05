import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("authoritative A-N journey manifest maps every label to an exercised test",async()=>{
  const manifest=JSON.parse(await readFile(new URL("./acceptance-journeys.json",import.meta.url),"utf8"));
  assert.deepEqual(manifest.map(item=>item.id),"ABCDEFGHIJKLMN".split(""));
  for(const item of manifest){
    assert.ok(item.journey&&item.file&&item.test,`${item.id} is incomplete`);
    const source=await readFile(new URL(`./${item.file}`,import.meta.url),"utf8");
    assert.ok(source.includes(`test(\"${item.test}\"`)||source.includes(`test('${item.test}'`),`${item.id} test label is not executable`);
  }
});
