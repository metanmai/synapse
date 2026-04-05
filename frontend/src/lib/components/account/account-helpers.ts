export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function isExpiredAt(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < now;
}

export function formatRenewalDate(periodEnd: string | null): string | null {
  if (!periodEnd) return null;
  return new Date(periodEnd).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
