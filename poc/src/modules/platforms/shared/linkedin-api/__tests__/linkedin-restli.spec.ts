import {
  encodeUrn,
  restliDate,
  restliDateRange,
  restliList,
  restliTimeIntervals,
} from '../linkedin-restli';

describe('linkedin-restli', () => {
  test('encodeUrn percent-encodes colons', () => {
    expect(encodeUrn('urn:li:organization:123')).toBe(
      'urn%3Ali%3Aorganization%3A123',
    );
  });

  test('restliDate renders (year:Y,month:M,day:D)', () => {
    expect(restliDate(new Date(Date.UTC(2026, 4, 4)))).toBe(
      '(year:2026,month:5,day:4)',
    );
  });

  test('restliDateRange composes start+end', () => {
    const start = new Date(Date.UTC(2026, 4, 4));
    const end = new Date(Date.UTC(2026, 5, 4));
    expect(restliDateRange(start, end)).toBe(
      '(start:(year:2026,month:5,day:4),end:(year:2026,month:6,day:4))',
    );
  });

  test('restliList keeps commas raw but encodes URNs', () => {
    expect(restliList(['urn:li:share:1', 'urn:li:share:2'])).toBe(
      'List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)',
    );
  });

  test('restliTimeIntervals renders epoch-ms day granularity', () => {
    expect(restliTimeIntervals(1000, 2000)).toBe(
      '(timeRange:(start:1000,end:2000),timeGranularityType:DAY)',
    );
  });
});
