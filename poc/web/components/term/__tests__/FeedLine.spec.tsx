import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeedLine from '../FeedLine';

describe('FeedLine', () => {
  it('renders time, platform tag, message and status', () => {
    render(
      <FeedLine time="12:04:11" platform="instagram" status={{ text: 'OK 142ms', tone: 'ok' }}>
        @glossier profile_sync
      </FeedLine>,
    );
    expect(screen.getByText('12:04:11')).toBeInTheDocument();
    expect(screen.getByText('[IG]')).toBeInTheDocument();
    expect(screen.getByText('@glossier profile_sync')).toBeInTheDocument();
    expect(screen.getByText('OK 142ms')).toBeInTheDocument();
  });
  it('applies the danger tone class to status', () => {
    render(
      <FeedLine time="12:03:39" status={{ text: 'ERR 429', tone: 'danger' }}>
        audience_demo
      </FeedLine>,
    );
    expect(screen.getByText('ERR 429').className).toContain('text-term-danger');
  });
});
