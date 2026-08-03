import fs from 'fs';
import os from 'os';
import path from 'path';

async function execCheck(command, args) {
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || stdout || err.message).trim()));
        return;
      }
      resolve();
    });
  });
}

export async function checkSyntaxForContent(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.ts', '.py'].includes(ext)) {
    return { valid: true, language: ext || 'unknown', skipped: true };
  }

  const tempPath = path.join(
    os.tmpdir(),
    `lmstudio-syntax-${process.pid}-${Date.now()}${ext || '.txt'}`
  );
  fs.writeFileSync(tempPath, content, 'utf8');
  try {
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      await execCheck('node', ['--check', tempPath]);
    } else if (ext === '.py') {
      let lastError = null;
      for (const pythonCmd of ['python3', 'python']) {
        try {
          await execCheck(pythonCmd, ['-m', 'py_compile', tempPath]);
          return { valid: true, language: 'python', checkedWith: pythonCmd };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    } else {
      return { valid: true, language: ext, skipped: true };
    }
    return { valid: true, language: ext.replace('.', ''), checkedWith: 'node' };
  } catch (error) {
    return {
      valid: false,
      language: ext.replace('.', ''),
      error: error.message,
      guidance: 'Fix syntax errors in the buffer before edit_commit. Use edit_review to inspect bracket balance and syntax.'
    };
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore temp cleanup errors
    }
  }
}
