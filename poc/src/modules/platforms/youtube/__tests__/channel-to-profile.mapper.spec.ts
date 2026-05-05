import { channelToProfile } from '../mapper/channel-to-profile.mapper';
import type { YoutubeChannel } from '../../shared/youtube-api/youtube-types';

describe('channelToProfile', () => {
  it('maps a fully-populated channel into ProfileData', () => {
    const ch: YoutubeChannel = {
      id: 'UC12345',
      snippet: {
        title: 'Demo Creator',
        description: 'Best demo channel',
        customUrl: '@democreator',
        publishedAt: '2010-01-15T00:00:00Z',
        thumbnails: {
          default: { url: 'https://yt/d.jpg' },
          medium: { url: 'https://yt/m.jpg' },
          high: { url: 'https://yt/h.jpg' },
        },
        country: 'ES',
      },
      statistics: {
        viewCount: '42000000',
        subscriberCount: '120000',
        videoCount: '321',
      },
      contentDetails: { relatedPlaylists: { uploads: 'UU12345' } },
      brandingSettings: { channel: { country: 'ES' } },
      topicDetails: {
        topicCategories: ['https://en.wikipedia.org/wiki/Music'],
      },
    };
    const out = channelToProfile(ch);
    expect(out.username).toBe('democreator');
    expect(out.displayName).toBe('Demo Creator');
    expect(out.followersCount).toBe(120000);
    expect(out.postsCount).toBe(321);
    expect(out.profileUrl).toBe('https://www.youtube.com/@democreator');
    expect(out.avatarUrl).toBe('https://yt/h.jpg');
    expect(out.accountType).toBe('brand');
    expect(out.category).toBe('Music');
    expect(out.verified).toBeNull();
  });

  it('falls back to /channel/<id> when customUrl missing', () => {
    const out = channelToProfile({
      id: 'UCXXXXXX',
      snippet: { title: 'No URL' },
    });
    expect(out.profileUrl).toBe('https://www.youtube.com/channel/UCXXXXXX');
    expect(out.username).toBeNull();
    expect(out.accountType).toBeNull();
  });
});
