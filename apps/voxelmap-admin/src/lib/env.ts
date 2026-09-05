export function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(
      `missing required env var: ${name}. See apps/voxelmap-admin/README.md for local dev setup.`,
    );
  }
  return value;
}
