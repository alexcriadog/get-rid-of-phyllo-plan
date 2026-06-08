// One-shot Mongo migration for the canonical-data-API collapse. Run with:
//   mongosh connector_ui scripts/migrate-mongo-canonical.js
//
// Merges the historical phyllo_* canonical docs into the clean collection
// names (keepExisting → never clobbers fresher docs the worker already wrote
// post-deploy), then drops the legacy internal collections. Idempotent.

const merges = [
  ['phyllo_profiles', 'profiles', 'id'],
  ['phyllo_contents', 'contents', 'id'],
  ['phyllo_audience', 'audience', 'id'],
  ['phyllo_comments', 'comments', 'id'],
];

function exists(name) {
  return db.getCollectionNames().indexOf(name) !== -1;
}

for (const [src, dst, on] of merges) {
  if (!exists(src)) { print(`skip ${src} (absent)`); continue; }
  const n = db.getCollection(src).countDocuments();
  db.getCollection(src).aggregate([
    { $merge: { into: dst, on, whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
  ]).toArray();
  db.getCollection(src).drop();
  print(`merged ${n} docs ${src} → ${dst}, dropped ${src}`);
}

// emit-state markers regenerate harmlessly; just drop the old one.
if (exists('phyllo_emit_state')) { db.phyllo_emit_state.drop(); print('dropped phyllo_emit_state'); }

// Remove stray old-format comment docs (internal shape lacks account_pk).
const removed = db.comments.deleteMany({ account_pk: { $exists: false } });
print(`removed ${removed.deletedCount} legacy internal comment docs`);

// Drop legacy internal collections (no longer written).
for (const c of ['posts', 'identity_snapshots', 'audience_snapshots']) {
  if (exists(c)) { db.getCollection(c).drop(); print(`dropped ${c}`); }
}

print('canonical mongo migration done');
print('counts → ' + ['profiles','contents','audience','comments'].map(c => c + ':' + db.getCollection(c).countDocuments()).join(', '));
