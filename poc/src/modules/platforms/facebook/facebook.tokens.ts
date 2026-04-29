// DI tokens for the Facebook platform module. Phase B4.
// Lives in its own file so the adapter and the module can both import it
// without forming a circular dependency.

export const FACEBOOK_GRAPH_CLIENT = Symbol('FACEBOOK_GRAPH_CLIENT');
