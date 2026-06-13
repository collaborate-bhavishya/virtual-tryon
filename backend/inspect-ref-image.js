import * as genai from '@google/genai';

console.log("--- Exports from @google/genai ---");
Object.keys(genai).forEach(k => {
  console.log(`- ${k}`);
});
