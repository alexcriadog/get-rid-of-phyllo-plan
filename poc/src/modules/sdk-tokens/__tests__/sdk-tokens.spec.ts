import { SdkTokensService } from '../sdk-tokens.service';
import type {
  WorkspaceView,
  WorkspacesService,
} from '@modules/workspaces/workspaces.service';

// Minimal WorkspacesService double: mint() reads the workspace view (for the
// products gate + the Sec-4 origins claim) and the HMAC secret; verify() reads
// the same secret back. A fixed 32-byte secret keeps sign/verify symmetric.
const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

function makeService(allowedOrigins?: string[]): SdkTokensService {
  const view: WorkspaceView = {
    id: 'wkspc_demo',
    slug: 'demo',
    name: 'Demo',
    branding: null,
    products: { tiktok: ['identity'] },
    webhookCadence: null,
    allowedOrigins,
    planTier: 'standard',
  };
  const workspaces = {
    findById: jest.fn().mockResolvedValue(view),
    getSecret: jest.fn().mockResolvedValue(SECRET),
  } as unknown as WorkspacesService;
  return new SdkTokensService(workspaces);
}

const baseInput = {
  workspaceId: 'wkspc_demo',
  workspaceSlug: 'demo',
  endUserId: 'user-123',
};

describe('SdkTokensService — Sec-4 origins claim', () => {
  it('embeds the workspace origin allow-list as a signed claim', async () => {
    const svc = makeService(['https://app.example.com', 'http://localhost:4000']);
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.origins).toEqual([
      'https://app.example.com',
      'http://localhost:4000',
    ]);
  });

  it('omits the origins claim when the workspace has no allow-list', async () => {
    const svc = makeService(undefined);
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.origins).toBeUndefined();
  });

  it('omits the origins claim for an empty allow-list', async () => {
    const svc = makeService([]);
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.origins).toBeUndefined();
  });

  it('still round-trips the core claims alongside origins', async () => {
    const svc = makeService(['https://app.example.com']);
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.ws).toBe('wkspc_demo');
    expect(claims.ws_slug).toBe('demo');
    expect(claims.sub).toBe('user-123');
  });
});
