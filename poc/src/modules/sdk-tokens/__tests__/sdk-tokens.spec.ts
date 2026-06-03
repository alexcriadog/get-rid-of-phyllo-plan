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

describe('SdkTokensService — per-connection products claim', () => {
  function makeRichService(): SdkTokensService {
    const view: WorkspaceView = {
      id: 'wkspc_demo',
      slug: 'demo',
      name: 'Demo',
      branding: null,
      products: {
        facebook: ['identity', 'audience', 'engagement_new', 'ads'],
        instagram: ['identity', 'audience'],
      },
      webhookCadence: null,
      allowedOrigins: undefined,
      planTier: 'standard',
    };
    const workspaces = {
      findById: jest.fn().mockResolvedValue(view),
      getSecret: jest.fn().mockResolvedValue(SECRET),
    } as unknown as WorkspacesService;
    return new SdkTokensService(workspaces);
  }

  it('embeds a validated products scope as a signed claim', async () => {
    const svc = makeRichService();
    const { token } = await svc.mint({
      ...baseInput,
      connectionProducts: { facebook: ['audience'] },
    });
    const claims = await svc.verify(token);
    expect(claims.products).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('omits the products claim when none is requested', async () => {
    const svc = makeRichService();
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.products).toBeUndefined();
  });

  it('rejects a scope that exceeds the workspace ceiling', async () => {
    const svc = makeRichService();
    await expect(
      svc.mint({
        ...baseInput,
        connectionProducts: { instagram: ['ads'] }, // ads not in IG ceiling
      }),
    ).rejects.toThrow();
  });
});
