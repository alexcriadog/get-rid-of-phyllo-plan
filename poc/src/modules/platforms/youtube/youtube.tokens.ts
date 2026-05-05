// DI tokens for the YouTube platform module. Mirrors threads.tokens.ts /
// tiktok.tokens.ts. Lives in its own file so the adapter and the module can
// both import it without forming a circular dependency.

export const YOUTUBE_API_CLIENT = Symbol('YOUTUBE_API_CLIENT');
