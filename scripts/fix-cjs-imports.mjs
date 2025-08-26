import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function walk(dir, cb) {
  const items = await readdir(dir);
  for (const name of items) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, cb);
    else await cb(p);
  }
}

const root = fileURLToPath(new URL('../dist/cjs/', import.meta.url));
await walk(root, async (filePath) => {
  if (extname(filePath) === '.cjs') {
    const content = await readFile(filePath, 'utf-8');
    // Заменяем импорты .js на .cjs в CommonJS файлах
    const updatedContent = content
      .replace(/require\("([^"]+)\.js"\)/g, 'require("$1.cjs")')
      .replace(/require\('([^']+)\.js'\)/g, "require('$1.cjs')");
    
    if (content !== updatedContent) {
      await writeFile(filePath, updatedContent, 'utf-8');
      console.log(`updated imports in ${filePath}`);
    }
  }
});
