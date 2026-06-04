import {
  linkedInMemberToProfile,
  linkedInOrganizationToProfile,
} from '../mapper/linkedin-profile.mapper';

describe('linkedInMemberToProfile', () => {
  test('maps the full member shape', () => {
    const profile = linkedInMemberToProfile({
      me: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        localizedHeadline: 'API Enthusiast',
        vanityName: 'bsmith',
        profilePicture: {
          'displayImage~': {
            elements: [
              { identifiers: [{ identifier: 'https://media.licdn.com/p.jpg' }] },
            ],
          },
        },
      },
      followersCount: 1200,
      connectionsSize: 504,
    });
    expect(profile.username).toBe('bsmith');
    expect(profile.displayName).toBe('Bob Smith');
    expect(profile.biography).toBe('API Enthusiast');
    expect(profile.avatarUrl).toBe('https://media.licdn.com/p.jpg');
    expect(profile.profileUrl).toBe('https://www.linkedin.com/in/bsmith');
    expect(profile.followersCount).toBe(1200);
    expect(profile.connectionsCount).toBe(504);
    expect(profile.accountType).toBe('member');
  });

  test('survives a minimal member shape', () => {
    const profile = linkedInMemberToProfile({
      me: { id: 'abc' },
      followersCount: null,
      connectionsSize: null,
    });
    expect(profile.username).toBeNull();
    expect(profile.displayName).toBeNull();
    expect(profile.profileUrl).toBeNull();
    expect(profile.followersCount).toBeNull();
    expect(profile.connectionsCount).toBeNull();
  });
});

describe('linkedInOrganizationToProfile', () => {
  test('maps the org shape', () => {
    const profile = linkedInOrganizationToProfile({
      org: {
        id: 2414183,
        localizedName: 'Camaleonic',
        vanityName: 'camaleonic',
        localizedDescription: 'Analytics',
        localizedWebsite: 'https://camaleonic.com',
      },
      followerCount: 9000,
    });
    expect(profile.username).toBe('camaleonic');
    expect(profile.displayName).toBe('Camaleonic');
    expect(profile.profileUrl).toBe(
      'https://www.linkedin.com/company/camaleonic',
    );
    expect(profile.followersCount).toBe(9000);
    expect(profile.website).toBe('https://camaleonic.com');
    expect(profile.accountType).toBe('organization');
  });
});
