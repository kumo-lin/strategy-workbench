#!/usr/bin/env bash
# D-56: DeepSeek writes the code, the Claude session reviews it.
# Usage: ds-code.sh <worktree> <spec.md> [max-turns]
# Runs headless Claude Code with DeepSeek as the backend inside <worktree>.
# The key is read at run time, never printed, never written; output is scrubbed.
# DeepSeek may read/edit files in the worktree and run tests / read-only git. No commit, no push, no build, no E2E.
set -euo pipefail
WT=$(cd "$1" && pwd); SPEC=$2; TURNS=${3:-80}
[ -f "$SPEC" ] || { echo "spec not found: $SPEC" >&2; exit 2; }
ROOT=$(git -C "$WT" rev-parse --show-toplevel 2>/dev/null || echo "$WT")
KEY=${DEEPSEEK_API_KEY:-}
[ -n "$KEY" ] || KEY=$(grep -E '^DEEPSEEK_API_KEY=' "$ROOT/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' ")
[ -n "$KEY" ] || { echo "no DEEPSEEK_API_KEY" >&2; exit 2; }
NOTES="$ROOT/.scratch/dev-logs"
RECORD="$ROOT/docs/dev-log/coding-agents-log.md"
mkdir -p "$NOTES"
LOG="$NOTES/$(basename "$WT")_$(date -u +%Y%m%dT%H%M%SZ).log"
RULES='You are writing code in this git worktree for a Next.js 16 / React 19 / TypeScript project (pnpm, vitest, zod 4, AI SDK v6).
Rules: follow the spec exactly and touch only what it names; match the surrounding code style; write or update the unit tests the spec asks for first, then the code;
run `pnpm -s typecheck`, `pnpm -s lint` and only the relevant test files with `pnpm -s vitest run --maxWorkers=2 <file>` until they pass (never the whole suite: the machine is shared);
never change an existing test'"'"'s assertion or expected value unless the spec has a line `ALLOW-TEST-EDIT: <path>` for that file (anything else is reverted by a guard and the task fails); if an existing test fails, leave it failing and report it with the reason in your summary;
never commit, push, run E2E, run `pnpm build`, start a server, or read .env files.
When done, print a short summary: files changed, tests run with their result, anything you could not do.'
cd "$WT"
# Test guard: every test file in HEAD (tests/**, *.test.ts(x), e2e/**/*.spec.ts) is snapshotted as it is now; after the
# run, one that changed and is not named in the spec as `ALLOW-TEST-EDIT: <path>` is put back and the task fails (exit 3).
# New test files are not restricted.
TESTS_RE='^tests/|^e2e/.*\.spec\.ts$|\.test\.tsx?$'
SNAP=$(mktemp -d)
trap 'rm -rf "$SNAP"' EXIT
git -c core.quotePath=false ls-tree -r --name-only HEAD | grep -E "$TESTS_RE" > "$SNAP/list" || true
while IFS= read -r f; do
  [ -e "$f" ] || continue
  mkdir -p "$SNAP/files/$(dirname "$f")" && cp -p "$f" "$SNAP/files/$f"
done < "$SNAP/list"
ALLOWED=$(grep -E '^ALLOW-TEST-EDIT: ' "$SPEC" | sed 's/^ALLOW-TEST-EDIT: //; s/[[:space:]]*$//' || true)
set +e
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic ANTHROPIC_AUTH_TOKEN="$KEY" ANTHROPIC_API_KEY= \
ANTHROPIC_MODEL=deepseek-flash ANTHROPIC_SMALL_FAST_MODEL=deepseek-flash \
claude -p "$(cat "$SPEC")" --model deepseek-flash \
  --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --tools "Read,Edit,Write,Bash,Glob,Grep" --permission-mode acceptEdits --max-turns "$TURNS" \
  --append-system-prompt "$RULES" \
  --allowedTools "Bash(pnpm -s typecheck*)" "Bash(pnpm -s lint*)" "Bash(pnpm -s test*)" "Bash(pnpm -s vitest*)" "Bash(pnpm vitest*)" "Bash(pnpm exec vitest*)" "Bash(pnpm exec tsc*)" "Bash(pnpm exec eslint*)" \
    "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(git show*)" "Bash(ls*)" "Bash(cat*)" "Bash(head*)" "Bash(tail*)" "Bash(wc*)" "Bash(grep*)" "Bash(find*)" \
  --disallowedTools "Bash(git push*)" "Bash(git commit*)" "Bash(git reset*)" "Bash(git checkout*)" "Bash(git merge*)" "Bash(git rebase*)" "Bash(pnpm build*)" "Bash(pnpm -s build*)" "Bash(pnpm dev*)" "Bash(pnpm -s test:e2e*)" "Bash(rm*)" \
    "Read(./.env*)" "Read(**/.env*)" \
  < /dev/null 2>&1 | sed "s/$KEY/***/g" | tee "$LOG"
RC=${PIPESTATUS[0]}
BAD=()
while IFS= read -r f; do
  [ -e "$SNAP/files/$f" ] || continue
  printf '%s\n' "$ALLOWED" | grep -qxF -- "$f" && continue
  if ! cmp -s "$SNAP/files/$f" "$f"; then
    BAD+=("$f"); mkdir -p "$(dirname "$f")" && cp -p "$SNAP/files/$f" "$f"
  fi
done < "$SNAP/list"
if [ ${#BAD[@]} -gt 0 ]; then
  echo "--- TEST GUARD: task rejected, it changed existing tests not allowed by the spec; put back as before the run:" | tee -a "$LOG"
  printf '    %s\n' "${BAD[@]}" | tee -a "$LOG"
  printf '%s | %s | %s | 打回（代码守卫） | 改了已有测试 %d 个：%s，已退回 | — | —\n' "$(TZ=Asia/Tokyo date '+%m/%d %H:%M JST')" "$(basename "$WT")" "$(basename "$SPEC")" "${#BAD[@]}" "$(IFS=,; echo "${BAD[*]}")" \
    >> "$RECORD"
  RC=3
fi
echo "--- ds-code exit=$RC log=$LOG"
exit "$RC"
