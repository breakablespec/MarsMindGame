// Minimal type for the one Node import the function uses (no @types/node needed).
declare module 'node:crypto' { export const webcrypto: unknown; }
