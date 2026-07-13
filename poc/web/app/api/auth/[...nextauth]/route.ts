// App-router route handler for Auth.js. Next 14 lets an app/ route coexist
// with the pages/ dir; this pure route handler needs no root layout.
import { handlers } from '../../../../auth';

export const { GET, POST } = handlers;
