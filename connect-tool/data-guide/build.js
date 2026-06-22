// Capability model for the Data Guide explorer — driven by the team's
// declarative support matrices (NOT sample data / holdings).
//   yes    → ✓ offered            (support matrix `supported`)
//   caveat → ✓△ offered w/ caveat (support matrix `empty_possible`; reason shown)
//   no     → — not offered        (`not_supported` / absent)
// capability-map.json = support-matrices × mappers, resolved to InsightIQ field names.
const fs = require('fs');
const guide = JSON.parse(fs.readFileSync('./seed-empirical.json', 'utf8'));   // field universe + productsByPlatform
const types = JSON.parse(fs.readFileSync('./field-types.json', 'utf8'));  // schema data type per field
const capmap = JSON.parse(fs.readFileSync('./capability-map.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('./derived-overrides.json', 'utf8')); // derived-field reconciliation // authoritative capability
const digest = fs.readFileSync('./phyllo-airtable-digest.md', 'utf8');

const CATALOG = {
  YouTube: ['identity','audience','engagement_new','engagement_deep','comments','ads'],
  Instagram: ['identity','audience','engagement_new','stories'],
  TikTok: ['identity','audience','engagement_new','comments'],
  Threads: ['identity','audience','engagement_new','comments','mentions'],
  Facebook: ['identity','audience','engagement_new','stories','mentions','comments','ratings','ads'],
  LinkedIn: ['identity','audience','engagement_new','comments','mentions'],
  Twitch: ['identity','engagement_new'],
};
const TABLE_PRODUCT = { Identity: 'identity', Engagement: 'engagement_new', Audience: 'audience', Comments: 'comments' };
const PLATS = ['YouTube','Instagram','TikTok','Threads','Facebook','LinkedIn','Twitch'];

const CURATED_DESC = {
  addresses: 'Postal addresses listed on the profile.',
  emails: 'Email addresses associated with the profile.',
  phone_numbers: 'Phone numbers associated with the profile.',
  username: 'Account username / handle on the platform.',
  'engagement.additional_info': 'Container for platform-specific extra metrics (see nested keys).',
  'engagement.click_count': 'Total clicks on the content item (e.g. link clicks).',
  'engagement.dislike_count': 'Total dislikes (owner-only, where the platform exposes it).',
  'engagement.email_click_rate': 'Email click-through rate (newsletter content).',
  'engagement.email_open_rate': 'Email open rate (newsletter content).',
  'engagement.impression_paid_count': 'Total paid impressions on the content item.',
  'engagement.replay_count': 'Total replays of the content item.',
  'engagement.repost_count': 'Total reposts of the content item (e.g. Threads reposts).',
  'engagement.spam_report_count': 'Number of spam reports on the content item.',
  'engagement.unsubscribe_count': 'Unsubscribes attributed to the content item (newsletter).',
  countries: 'Audience distribution by country (percentage per country).',
  cities: 'Audience distribution by city (percentage per city).',
  gender_distribution: 'Audience distribution by gender (percentage per gender).',
  age_distribution: 'Audience distribution by age range (percentage per range).',
  gender_age_distribution: 'Joint audience distribution by gender × age range.',
  media_urls: 'All media URLs for multi-media items (carousels / albums).',
  content_tags: 'Tags or labels classifying the content item.',
  authors: 'Authors or creators credited on the content item.',
  collaboration: 'Collaboration metadata (co-authors / collaborators).',
  sponsored: 'Sponsorship metadata (sponsored flag and sponsor tags).',
  platform: 'Source platform identifier for the content item.',
  audience: 'Per-content audience demographics (viewers of this item).',
  audience_types: 'Viewer audience-type breakdown (e.g. followers vs non-followers).',
  'insights.audience_retention': 'Audience retention curve for the content item.',
  'insights.traffic_sources': 'Where views came from (search, feed, external…).',
  'insights.viewer_demographics': 'Viewer demographic breakdown for the item.',
  'insights.viewer_types': 'Viewer type breakdown (new / returning / subscribed).',
  'insights.sharing': 'Shares by destination/service for the item.',
  'insights.devices': 'Views by device type.',
  'insights.likes_timeline': 'Per-second likes timeline for the item.',
  'insights.retention_curve': 'Per-second view-retention curve for the item.',
  insights: 'Deep per-item analytics bundle (platform-specific).',
};
const DESC = {};
const SKIP = new Set(['Field Name','Field name','Request field','Platform','Description','']);
for (const line of digest.split('\n')) {
  if (!line.startsWith('| ') || /^\|\s*:?-+/.test(line)) continue;
  const cols = line.split('|').map((s) => s.trim());
  const field = (cols[1] || '').replace(/\s+/g, ' ').trim();
  const desc = (cols[2] || '').replace(/\s+/g, ' ').trim();
  if (SKIP.has(field) || /^-+$/.test(field)) continue;
  if (desc && !DESC[field]) DESC[field] = desc;
}
function describe(name) {
  if (CURATED_DESC[name]) return CURATED_DESC[name];
  if (DESC[name]) return DESC[name];
  if (name.startsWith('insights.extra.metrics.')) return 'YouTube Analytics metric: ' + name.split('.').pop().replace(/([A-Z])/g, ' $1').toLowerCase() + '.';
  if (name.startsWith('engagement.additional_info.')) return 'Platform extra metric: ' + name.split('.').pop().replace(/_/g, ' ') + '.';
  if (name.startsWith('insights.')) return 'Deep analytics: ' + name.split('.').slice(1).join(' ').replace(/_/g, ' ') + '.';
  if (name.startsWith('audience.')) return 'Per-content audience breakdown: ' + name.split('.').slice(1).join(' ').replace(/_/g, ' ') + '.';
  return '';
}
const MATURITY = { 'persistent_thumbnail_url': 'planned' };
const familyOf = (n) => n.includes('.') ? n.split('.')[0] : 'core';

const out = { generatedAt: guide.generatedAt, productsByPlatform: guide.productsByPlatform, tables: {} };
const caveats = capmap.caveats || {};
let fellBack = 0;

for (const table of Object.keys(guide.fields)) {
  const product = TABLE_PRODUCT[table];
  const offered = {}; PLATS.forEach((p) => offered[p] = (CATALOG[p] || []).includes(product));
  const map = capmap[table] || {};
  const ttypes = types[table] || {};

  const fields = Object.keys(guide.fields[table]).sort().map((name) => {
    const support = {}; const caveat = {};
    const cell = map[name];
    PLATS.forEach((p) => {
      let state = cell ? cell[p] : (guide.fields[table][name][p] ? 'yes' : 'no'); // fallback to empirical if unmapped
      if (!cell) fellBack++;
      const ovr = overrides[table] && overrides[table][name] && overrides[table][name][p];
      if (state === 'no' && ovr) state = ovr; // derived-field reconciliation (upgrade only)
      support[p] = state !== 'no';
      if (state === 'caveat') caveat[p] = caveats[`${table}::${name}::${p}`] || (overrides.caveats && overrides.caveats[`${table}::${name}::${p}`]) || 'Offered with access conditions.';
    });
    return {
      name, desc: describe(name), type: ttypes[name] || '',
      family: familyOf(name), maturity: MATURITY[name] || 'production',
      support, caveat: Object.keys(caveat).length ? caveat : undefined,
    };
  });
  out.tables[table] = { product, offered, fields };
}

out.audienceNote = 'Offered = the platform’s API exposes it to us (from our per-platform support matrices). TikTok audience is offered too — gated above the ≥100-follower threshold (✓△). Threads & Twitch expose no audience demographics. LinkedIn audience is organization-only.';

fs.writeFileSync('../app/data-guide/guide.json', JSON.stringify(out, null, 2));
const tally = { yes: 0, caveat: 0, no: 0 };
for (const t of Object.keys(out.tables)) out.tables[t].fields.forEach((f) => PLATS.forEach((p) => {
  tally[!f.support[p] ? 'no' : (f.caveat && f.caveat[p]) ? 'caveat' : 'yes']++;
}));
console.log('capability cells:', JSON.stringify(tally), '| unmapped-field fallbacks:', fellBack);
