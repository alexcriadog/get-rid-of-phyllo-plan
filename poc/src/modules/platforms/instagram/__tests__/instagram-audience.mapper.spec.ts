/**
 * Phase E pinning tests — targets exported pure functions in
 * mapper/instagram-audience.mapper.ts.
 */
import {
  parseFollowerDemographics,
  splitGenderAge,
} from '../mapper/instagram-audience.mapper';
import type { DistributionBucket } from '../../shared/platform-types';

describe('Instagram audience mapper (pinning)', () => {
  describe('parseFollowerDemographics', () => {
    it('breakdown with single dimension key (country)', () => {
      expect(
        parseFollowerDemographics([
          {
            name: 'follower_demographics',
            period: 'lifetime',
            values: [],
            total_value: {
              breakdowns: [
                {
                  dimension_keys: ['country'],
                  results: [
                    { dimension_values: ['ES'], value: 1200 },
                    { dimension_values: ['US'], value: 850 },
                    { dimension_values: ['MX'], value: 410 },
                  ],
                },
              ],
            },
          },
        ]),
      ).toMatchSnapshot();
    });

    it('breakdown with multi dimension keys (gender + age)', () => {
      expect(
        parseFollowerDemographics([
          {
            name: 'follower_demographics',
            period: 'lifetime',
            values: [],
            total_value: {
              breakdowns: [
                {
                  dimension_keys: ['gender', 'age'],
                  results: [
                    { dimension_values: ['F', '18-24'], value: 320 },
                    { dimension_values: ['M', '18-24'], value: 280 },
                    { dimension_values: ['F', '25-34'], value: 410 },
                    { dimension_values: ['U', '65+'], value: 4 },
                  ],
                },
              ],
            },
          },
        ]),
      ).toMatchSnapshot();
    });

    it('empty data returns empty', () => {
      expect(parseFollowerDemographics([])).toEqual([]);
    });

    it('breakdown with empty dimension_values is skipped', () => {
      expect(
        parseFollowerDemographics([
          {
            name: 'follower_demographics',
            period: 'lifetime',
            values: [],
            total_value: {
              breakdowns: [
                {
                  dimension_keys: ['country'],
                  results: [
                    { dimension_values: [], value: 100 },
                    { dimension_values: ['ES'], value: 200 },
                  ],
                },
              ],
            },
          },
        ]),
      ).toMatchSnapshot();
    });
  });

  describe('splitGenderAge', () => {
    it('typical FB-style F.18-24 / M.25-34 entries', () => {
      const gender: DistributionBucket[] = [];
      const age: DistributionBucket[] = [];
      splitGenderAge(
        [
          ['F.18-24', 100],
          ['M.18-24', 80],
          ['F.25-34', 130],
          ['M.25-34', 110],
          ['U.65+', 5],
        ],
        gender,
        age,
      );
      expect({ gender, age }).toMatchSnapshot();
    });

    it('label without dot falls into gender bucket as-is', () => {
      const gender: DistributionBucket[] = [];
      const age: DistributionBucket[] = [];
      splitGenderAge([['unsplittable', 7]], gender, age);
      expect({ gender, age }).toMatchSnapshot();
    });

    it('empty entries leaves both buckets empty', () => {
      const gender: DistributionBucket[] = [];
      const age: DistributionBucket[] = [];
      splitGenderAge([], gender, age);
      expect({ gender, age }).toEqual({ gender: [], age: [] });
    });
  });
});
