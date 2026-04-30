// DI tokens for the Threads platform module. Mirrors facebook.tokens.ts /
// instagram.tokens.ts. Lives in its own file so the adapter and the module
// can both import it without forming a circular dependency.

export const THREADS_API_CLIENT = Symbol('THREADS_API_CLIENT');
