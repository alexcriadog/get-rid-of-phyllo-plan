import { describe, expect, it } from 'vitest';
import { getDefaultNormalizer, render, screen } from '@testing-library/react';
import StatBlock from '../StatBlock';
import { fmtStatNumber } from '@/lib/format';

describe('StatBlock', () => {
  it('renders label and thin-space formatted numeral', () => {
    render(<StatBlock label="syncs / 24h" value={48204} />);
    expect(screen.getByText('syncs / 24h')).toBeInTheDocument();
    expect(
      screen.getByText(fmtStatNumber(48204), {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeInTheDocument();
  });
  it('renders string values verbatim', () => {
    render(<StatBlock label="success" value="99.4%" />);
    expect(screen.getByText('99.4%')).toBeInTheDocument();
  });
  it('renders delta with direction arrow and sub text', () => {
    render(
      <StatBlock label="syncs" value={1} delta={{ text: '12% vs prev', tone: 'up' }} sub="stable" />,
    );
    expect(screen.getByText(/12% vs prev/)).toBeInTheDocument();
    expect(screen.getByText(/stable/)).toBeInTheDocument();
  });
});
