import fs from 'fs';
import path from 'path';
export async function loadCodexFile(relativePath) {
    const fullPath = path.join(process.cwd(), relativePath);
    const fileContent = await fs.promises.readFile(fullPath, 'utf-8');
    return JSON.parse(fileContent);
}
//# sourceMappingURL=loadCodex.js.map