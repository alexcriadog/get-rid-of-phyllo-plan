import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlatformGalleryStage from '../PlatformGalleryStage';

// The gallery renders PlatformTag (pure, lib-driven) and never touches the API,
// but we mock @/lib/api defensively to assert no network coupling leaks in.
vi.mock('@/lib/api', () => ({
  adminPost: vi.fn(),
}));

const CONNECT_TOOL_URL = 'http://localhost:3002';

function renderGallery(overrides: Partial<Parameters<typeof PlatformGalleryStage>[0]> = {}) {
  const props = {
    selected: 'facebook' as const,
    onSelect: vi.fn(),
    onContinue: vi.fn(),
    onManual: vi.fn(),
    connectToolUrl: CONNECT_TOOL_URL,
    ...overrides,
  };
  render(<PlatformGalleryStage {...props} />);
  return props;
}

describe('PlatformGalleryStage', () => {
  it('renders a card per discover platform (Meta, TikTok, Threads)', () => {
    renderGallery();
    expect(screen.getByText('Meta · FB + IG')).toBeInTheDocument();
    expect(screen.getByText('TikTok')).toBeInTheDocument();
    expect(screen.getByText('Threads')).toBeInTheDocument();
  });

  it('exposes the cards as a radiogroup of three options', () => {
    renderGallery();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('marks the selected platform with aria-checked', () => {
    renderGallery({ selected: 'tiktok' });
    const tiktok = screen.getByText('TikTok').closest('[role="radio"]')!;
    expect(tiktok).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onSelect with the platform id when a card is clicked', () => {
    const props = renderGallery();
    fireEvent.click(screen.getByText('Threads').closest('[role="radio"]')!);
    expect(props.onSelect).toHaveBeenCalledWith('threads');
  });

  it('shows availability metadata per platform card', () => {
    renderGallery();
    expect(screen.getByText('OAuth · discover')).toBeInTheDocument();
    expect(screen.getByText('BC token · discover')).toBeInTheDocument();
    expect(screen.getByText('user token · discover')).toBeInTheDocument();
  });

  it('continue button advances to credentials', () => {
    const props = renderGallery();
    fireEvent.click(screen.getByRole('button', { name: /credentials/i }));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
  });

  it('manual button triggers the bypass path', () => {
    const props = renderGallery();
    fireEvent.click(screen.getByRole('button', { name: /manual connect/i }));
    expect(props.onManual).toHaveBeenCalledTimes(1);
  });

  it('links to the connect-tool helper URL', () => {
    renderGallery();
    const link = screen.getByRole('link', { name: new RegExp(CONNECT_TOOL_URL) });
    expect(link).toHaveAttribute('href', CONNECT_TOOL_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders platform tags ([FB] [TT] [TH]) for each card', () => {
    renderGallery();
    expect(screen.getByText('[FB] facebook')).toBeInTheDocument();
    expect(screen.getByText('[TT] tiktok')).toBeInTheDocument();
    expect(screen.getByText('[TH] threads')).toBeInTheDocument();
  });
});
