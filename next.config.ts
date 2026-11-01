import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR=<name> lets two servers run from one checkout (S0 and S3 for rehearsal).
  // It must stay under .next/: elsewhere Tailwind scans the build cache and every page 500s.
  distDir: process.env.NEXT_DIST_DIR ? `.next/${process.env.NEXT_DIST_DIR}` : '.next',
  // Worktrees live inside the main checkout (.claude/worktrees/*); without this,
  // Turbopack sees the outer lockfile and picks the main checkout as its root.
  turbopack: { root: import.meta.dirname },
  // Dev only: the indicator's default corner (bottom-left) covers the sidebar's 当前身份 (D-64 T44).
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
