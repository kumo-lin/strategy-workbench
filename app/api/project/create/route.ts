/** POST /api/project/create — the Senior's "＋ 新建项目": create 20_项目/<名字>/项目.md and 日志.md. */
import { z } from 'zod';
import { createProject, ProjectCreateError } from '@/lib/project/create';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { errorResponse } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string(),
  coreQuestion: z
    .string()
    .trim()
    .min(1, '问题不能为空')
    .max(300, '问题最多 300 个字')
    .refine((v) => !/[\r\n]/.test(v), '问题不能换行'),
  supportsDecision: z.string().trim().max(300, '支撑的决策最多 300 个字').optional(),
});

export async function POST(req: Request) {
  try {
    const input = bodySchema.parse(await req.json());
    const result = await createProject({
      vault: getVault(),
      actor: await getCurrentRole(),
      name: input.name,
      coreQuestion: input.coreQuestion,
      supportsDecision: input.supportsDecision,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof ProjectCreateError) {
      return Response.json({ error: e.code, message: e.message }, { status: e.code === 'invalid_name' ? 400 : 409 });
    }
    return errorResponse(e);
  }
}
