import { ThreadsProfileFetcher } from '../threads-profile.fetcher';

// Minimal stub of BoundThreadsClient: routes the two calls (profile vs
// insights) by endpoint so we can assert how followersCount is derived.
function makeClient(
  impl: (req: { endpoint: string; params?: Record<string, unknown> }) => unknown,
) {
  return { call: jest.fn(impl) } as never;
}

const ACCESS = 'tok';
const CANON = '24347837561543544';

const PROFILE_BODY = {
  id: CANON,
  username: 'camaleonicanalytics',
  name: 'Camaleonic Analytics',
  threads_biography: 'bio',
  threads_profile_picture_url: 'https://pic',
  is_verified: false,
};

describe('ThreadsProfileFetcher', () => {
  it('populates followersCount from threads_insights total_value', async () => {
    const client = makeClient(({ endpoint }) =>
      endpoint.includes('threads_insights')
        ? { data: [{ name: 'followers_count', total_value: { value: 49 } }] }
        : PROFILE_BODY,
    );
    const profile = await new ThreadsProfileFetcher(client).fetch(ACCESS, CANON, {});

    expect(profile.followersCount).toBe(49);
    expect(profile.username).toBe('camaleonicanalytics');
    expect(profile.displayName).toBe('Camaleonic Analytics');
    expect(profile.profileUrl).toBe('https://www.threads.net/@camaleonicanalytics');
  });

  it('falls back to the latest values[] sample when total_value is absent', async () => {
    const client = makeClient(({ endpoint }) =>
      endpoint.includes('threads_insights')
        ? {
            data: [
              {
                name: 'followers_count',
                values: [
                  { value: 40, end_time: 't1' },
                  { value: 52, end_time: 't2' },
                ],
              },
            ],
          }
        : PROFILE_BODY,
    );
    const profile = await new ThreadsProfileFetcher(client).fetch(ACCESS, CANON, {});

    expect(profile.followersCount).toBe(52);
  });

  it('keeps followersCount null and still resolves the profile when insights fails', async () => {
    const client = makeClient(({ endpoint }) => {
      if (endpoint.includes('threads_insights')) {
        throw new Error('insights 400');
      }
      return PROFILE_BODY;
    });
    const profile = await new ThreadsProfileFetcher(client).fetch(ACCESS, CANON, {});

    // The identity snapshot must survive a follower-count failure.
    expect(profile.followersCount).toBeNull();
    expect(profile.username).toBe('camaleonicanalytics');
    expect(profile.biography).toBe('bio');
  });

  it('keeps followersCount null when insights returns an empty body', async () => {
    const client = makeClient(({ endpoint }) =>
      endpoint.includes('threads_insights') ? { data: [] } : PROFILE_BODY,
    );
    const profile = await new ThreadsProfileFetcher(client).fetch(ACCESS, CANON, {});

    expect(profile.followersCount).toBeNull();
  });
});
