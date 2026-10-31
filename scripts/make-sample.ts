// Writes public/sample.pdf — the "Try a sample document" file — from the test fixture.
import { writeFileSync, mkdirSync } from "node:fs";
import { sampleContract } from "../src/test/fixtures";

mkdirSync("public", { recursive: true });
writeFileSync("public/sample.pdf", await sampleContract(6));
console.log("public/sample.pdf written");
