'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * D-64 接手卡 C1: 页面读取失败时，说清「没读出来」和下一步动作。
 * 不写推测原因（v6 的风格是说事实、不猜），也不显示任何工程词或文件路径。
 *
 * 这一刻页面是最脆的：不依赖路由缓存，也不依赖客户端状态。
 * 「重试」= 重新向服务器要一次（整页刷新），「回首页」= 回首页链接。
 */
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  // 复核：not every error is a file being saved — keep the cause in the browser console and give the reader a number to report
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main
      data-testid="error-page"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="text-base font-medium text-foreground">这一步没读出来。</h1>
      <p className="text-sm text-muted-foreground">刷新重试；还不行就检查文件管理里的资料。</p>
      {error.digest ? <p className="text-xs text-muted-foreground">还不行，请把错误编号 {error.digest} 告诉开发者。</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          重试
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href="/">回首页</Link>
        </Button>
      </div>
    </main>
  );
}
