/**
 * Thin HTTP layer for the workspace routes: parse the body, take the acting
 * human from the server-side cookie (never from the body), run one review-flow
 * function, map errors to status codes.
 */
import { z } from 'zod';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { VaultError } from '@/lib/vault';
import { ReviewFlowError } from './review-flow';

/** A Workspace folder inside the vault: `20_项目/<项目>/<Workspace>`. */
export const workspacePathSchema = z
  .string()
  .regex(/^20_项目\/[^/]+\/[^/]+$/, '需要 20_项目/<项目>/<Workspace>')
  .refine((p) => !p.split('/').includes('..'), 'invalid path');

export function errorResponse(e: unknown): Response {
  if (e instanceof z.ZodError) {
    return Response.json({ error: 'invalid_request', message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  if (e instanceof ApprovalDenied) return Response.json({ error: 'forbidden', message: e.message }, { status: 403 });
  if (e instanceof ReviewFlowError) return Response.json({ error: 'conflict', message: e.message }, { status: 409 });
  if (e instanceof VaultError) {
    const status = e.code === 'not_found' ? 404 : e.code === 'invalid_path' ? 400 : 422;
    return Response.json({ error: e.code, message: e.message }, { status });
  }
  if (e instanceof SyntaxError) return Response.json({ error: 'invalid_request', message: 'body is not JSON' }, { status: 400 });
  console.error(e);
  return Response.json({ error: 'internal', message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

/** Parse the JSON body with `schema`, get the current role, run `run`, return its result as JSON. */
export async function handleJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  getRole: () => Promise<Role>,
  run: (input: z.infer<S>, actor: Role) => Promise<unknown>,
): Promise<Response> {
  try {
    const input = schema.parse(await req.json());
    return Response.json(await run(input, await getRole()));
  } catch (e) {
    return errorResponse(e);
  }
}
