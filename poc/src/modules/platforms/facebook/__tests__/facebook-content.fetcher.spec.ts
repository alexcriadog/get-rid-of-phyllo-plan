// Field-degrade contract of the extended /posts fetch (max-capture).
//
// Under test:
//   1. The first /posts call asks for lite + EXTRA fields (shares,
//      status_type, is_published, message_tags, place).
//   2. A Graph #100 field error naming one extra field retries the SAME page
//      with just that field dropped — the other extras survive.
//   3. A #100 that names no specific field drops all extras (lite fields).
//   4. Non-field errors propagate — no silent degrade.
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import { FacebookContentFetcher } from '../fetcher/facebook-content.fetcher';

type CallArgs = { endpoint: string; params?: Record<string, unknown> };

const POST_FIXTURE = {
  id: '12345_67890',
  message: 'hello',
  created_time: '2026-07-10T10:00:00+0000',
  permalink_url: 'https://facebook.com/12345/posts/67890',
  shares: { count: 4 },
};

function fieldError(message: string): unknown {
  return { body: { error: { message, code: 100 } } };
}

function makeFetcher(
  onPosts: (call: CallArgs, postsCallIndex: number) => unknown,
): { fetcher: FacebookContentFetcher; calls: CallArgs[] } {
  const calls: CallArgs[] = [];
  let postsCalls = 0;
  const client = {
    call: jest.fn(async (args: CallArgs) => {
      calls.push(args);
      if (args.endpoint.endsWith('/posts')) {
        postsCalls += 1;
        const out = onPosts(args, postsCalls);
        if (out instanceof Error || (out && (out as { body?: unknown }).body)) {
          throw out;
        }
        return out;
      }
      // /videos batch + per-post /insights probes: empty is fine.
      return { data: [] };
    }),
  } as unknown as BoundGraphClient;
  return { fetcher: new FacebookContentFetcher(client), calls };
}

function fieldsOfCall(call: CallArgs): string {
  return String(call.params?.fields ?? '');
}

describe('FacebookContentFetcher — extended fields with degrade', () => {
  it('asks for the extra fields on the first /posts call', async () => {
    const { fetcher, calls } = makeFetcher(() => ({ data: [POST_FIXTURE] }));
    const items = await fetcher.fetch('token', 'page1', { limit: 5 });
    expect(items).toHaveLength(1);
    const postsCall = calls.find((c) => c.endpoint === '/page1/posts');
    const fields = fieldsOfCall(postsCall!);
    for (const f of ['shares', 'status_type', 'message_tags', 'place']) {
      expect(fields).toContain(f);
    }
    expect(items[0].metrics.shares).toBe(4);
  });

  it('drops ONLY the rejected field and retries the same page', async () => {
    const { fetcher, calls } = makeFetcher((_call, n) => {
      if (n === 1) {
        return fieldError('Tried accessing nonexisting field (status_type)');
      }
      return { data: [POST_FIXTURE] };
    });
    const items = await fetcher.fetch('token', 'page1', { limit: 5 });
    expect(items).toHaveLength(1);
    const postsCalls = calls.filter((c) => c.endpoint === '/page1/posts');
    expect(postsCalls).toHaveLength(2);
    const retryFields = fieldsOfCall(postsCalls[1]);
    expect(retryFields).not.toContain('status_type');
    for (const f of ['shares', 'message_tags', 'place']) {
      expect(retryFields).toContain(f);
    }
  });

  it('drops all extras when the #100 error names no field we sent', async () => {
    const { fetcher, calls } = makeFetcher((_call, n) => {
      if (n === 1) return fieldError('Unsupported get request');
      return { data: [POST_FIXTURE] };
    });
    const items = await fetcher.fetch('token', 'page1', { limit: 5 });
    expect(items).toHaveLength(1);
    const postsCalls = calls.filter((c) => c.endpoint === '/page1/posts');
    expect(postsCalls).toHaveLength(2);
    const retryFields = fieldsOfCall(postsCalls[1]);
    for (const f of ['shares', 'status_type', 'message_tags', 'place']) {
      expect(retryFields).not.toContain(f);
    }
    expect(retryFields).toContain('comments.summary(total_count)');
  });

  it('propagates non-field errors instead of degrading', async () => {
    const { fetcher } = makeFetcher(() => ({
      body: { error: { message: 'boom', code: 1 } },
    }));
    await expect(fetcher.fetch('token', 'page1', { limit: 5 })).rejects.toBeTruthy();
  });
});
