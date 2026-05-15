// DI tokens for the Twitch platform module. Lives in its own file so the
// adapter, the fetchers and the module can all import it without forming a
// circular dependency. Mirrors youtube.tokens.ts.

export const TWITCH_API_CLIENT = Symbol('TWITCH_API_CLIENT');
