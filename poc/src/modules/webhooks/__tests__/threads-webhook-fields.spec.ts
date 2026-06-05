import {
  THREADS_FIELD_TO_PRODUCT,
  parseThreadsEnvelope,
} from '../threads-webhook-fields';

describe('THREADS_FIELD_TO_PRODUCT', () => {
  it('routes publish/replies/mentions/delete to engagement_new', () => {
    expect(THREADS_FIELD_TO_PRODUCT['publish']).toBe('engagement_new');
    expect(THREADS_FIELD_TO_PRODUCT['replies']).toBe('engagement_new');
    expect(THREADS_FIELD_TO_PRODUCT['mentions']).toBe('engagement_new');
    expect(THREADS_FIELD_TO_PRODUCT['delete']).toBe('engagement_new');
  });

  it('returns undefined for unmapped fields (caller applies its own default)', () => {
    expect(THREADS_FIELD_TO_PRODUCT['quotes']).toBeUndefined();
  });
});

describe('parseThreadsEnvelope', () => {
  const valid = {
    app_id: '123456',
    topic: 'interaction',
    target_id: '78901',
    time: 1723226877,
    subscription_id: '234567',
    values: {
      value: { id: '8901234', username: 'someone', text: 'Reply' },
      field: 'replies',
    },
  };

  it('extracts target/field/time/object id from a valid envelope', () => {
    expect(parseThreadsEnvelope(JSON.stringify(valid))).toEqual({
      targetId: '78901',
      field: 'replies',
      topic: 'interaction',
      time: 1723226877,
      objectId: '8901234',
    });
  });

  it('tolerates a missing values.value (publish may carry minimal value)', () => {
    const minimal = { ...valid, values: { field: 'publish' } };
    expect(parseThreadsEnvelope(JSON.stringify(minimal))).toEqual({
      targetId: '78901',
      field: 'publish',
      topic: 'interaction',
      time: 1723226877,
      objectId: null,
    });
  });

  it('coerces numeric target_id to string (Meta sometimes sends numbers)', () => {
    const numeric = { ...valid, target_id: 78901 };
    expect(parseThreadsEnvelope(JSON.stringify(numeric))?.targetId).toBe(
      '78901',
    );
  });

  it('returns null for invalid JSON', () => {
    expect(parseThreadsEnvelope('not-json{')).toBeNull();
  });

  it('returns null when target_id is absent', () => {
    const noTarget = { ...valid, target_id: undefined };
    expect(parseThreadsEnvelope(JSON.stringify(noTarget))).toBeNull();
  });

  it('returns null when values.field is absent', () => {
    const noField = { ...valid, values: { value: { id: 'x' } } };
    expect(parseThreadsEnvelope(JSON.stringify(noField))).toBeNull();
  });
});
