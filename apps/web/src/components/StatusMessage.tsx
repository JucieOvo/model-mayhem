/**
 * 真实错误与等待状态展示。
 *
 * 作者：JucieOvo
 */

export function ErrorMessage({ message }: { readonly message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <div className="rounded-[7px] border border-[color-mix(in_srgb,var(--danger)_72%,black)] bg-[color-mix(in_srgb,var(--danger)_15%,var(--surface-1))] px-3 py-2 text-sm">
      {message}
    </div>
  );
}

export function LoadingMessage({ label }: { readonly label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}
