/**
 * Source-text rules for the first-use E2E spec (a first-time user can only see the pages and click
 * what is on them) and for the mock agent (it must not branch on the words the user typed). Pure;
 * the spec itself is scanned from disk by the test, not here.
 */

/** Replace comments with spaces, keeping every newline so line numbers stay the same. */
function stripComments(src: string): string {
  let out = '';
  let inBlock = false;
  let inLine = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '\n') {
      out += '\n';
      inLine = false;
      continue;
    }
    if (inLine) {
      out += ' ';
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        out += '  ';
        i++;
        inBlock = false;
      } else out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i++;
      inBlock = true;
      continue;
    }
    if (ch === '/' && next === '/') {
      out += '  ';
      i++;
      inLine = true;
      continue;
    }
    out += ch;
  }
  return out;
}

const SOURCE_RULES: { re: RegExp; message: string }[] = [
  { re: /\bapiPost\s*\(/, message: 'calls the API directly (apiPost)' },
  { re: /\.request\.(?:post|get|put|delete)\s*\(/, message: 'calls the API directly (.request)' },
  { re: /\bfetch\s*\(/, message: 'calls fetch() instead of using the page' },
  { re: /\.evaluate(?:Handle)?\s*\(/, message: 'runs JavaScript in the page (evaluate)' },
  // Reading with readVaultFile (and resetting with resetVault / vaultFiles) is allowed.
  { re: /\b(?:writeFile|writeVaultFile|appendFile|rename|copyFile)\s*\(/, message: 'writes files from the test' },
  { re: /\brm\s*\(/, message: 'deletes files from the test' },
];

/** Violations of the first-use rules in the source text of a spec: "line N: message". Empty = clean. */
export function checkFirstUseSource(src: string): string[] {
  const found: string[] = [];
  stripComments(src)
    .split('\n')
    .forEach((line, i) => {
      const messages = SOURCE_RULES.filter((r) => r.re.test(line)).map((r) => r.message);
      const goto = /\.goto\s*\(/.test(line);
      if (goto) {
        const target = /\.goto\s*\(\s*(['"])([^'"]*)\1/.exec(line);
        if (!target || target[2] !== '/') messages.push("navigates with .goto() to something other than '/'");
      }
      // A test id may only be used inside an expect(...) assertion, on the same line.
      if (/getByTestId\s*\(/.test(line) && !/expect\s*\(/.test(line)) {
        messages.push('uses a test id outside an expect() assertion');
      }
      if (messages.length > 0) found.push(`line ${i + 1}: ${[...new Set(messages)].join('; ')}`);
    });
  return found;
}

const MOCK_RULES = [
  /lastUser\s*\.\s*(?:includes|startsWith|endsWith|match|test|indexOf)\s*\(/,
  /lastUser\s*===/,
];

/** Violations in the source text of the mock agent: it must not branch on the words the user typed. */
export function checkMockSource(src: string): string[] {
  const found: string[] = [];
  stripComments(src)
    .split('\n')
    .forEach((line, i) => {
      if (MOCK_RULES.some((re) => re.test(line))) found.push(`line ${i + 1}: branches on the words the user typed`);
    });
  return found;
}
