import * as fs from 'fs';

const filePath = './node_modules/@google/genai/dist/genai.d.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

let found = false;
let braces = 0;
lines.forEach((line, idx) => {
  if (line.includes('segmentImage') || line.includes('SegmentImageParameters') || line.includes('interface SegmentImageConfig')) {
    found = true;
  }
  if (found) {
    console.log(`L${idx+1}: ${line}`);
    if (line.includes('{')) braces++;
    if (line.includes('}')) braces--;
    if (braces === 0 && line.includes('}')) {
      found = false;
    }
  }
});
