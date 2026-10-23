/** Short per-user memory of the fee-defaulter check; cleared whenever a fee is collected or the fee settings change. */
export const defaulterCache = new Map<string, { blocked: boolean; at: number }>();
