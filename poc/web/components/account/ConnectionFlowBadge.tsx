import { Badge } from '@/components/ui/badge';

interface ConnectionFlowBadgeProps {
  /** accounts.connection_flow — 'ig_direct' | 'fb_login' | 'default' | undefined. */
  flow?: string | null;
  className?: string;
}

/**
 * Shows HOW an Instagram account was connected — Instagram Login ('ig_direct')
 * vs Facebook Login ('fb_login') — so two coexisting IG accounts for the same
 * handle are tellable apart. Renders nothing for single-connection platforms
 * (connection_flow 'default' / absent), so it can be dropped in anywhere an
 * account is shown.
 */
export function ConnectionFlowBadge({ flow, className }: ConnectionFlowBadgeProps) {
  if (flow !== 'ig_direct' && flow !== 'fb_login') return null;
  const isDirect = flow === 'ig_direct';
  return (
    <Badge
      variant={isDirect ? 'primary' : 'outline'}
      className={className}
      title={isDirect ? 'Instagram Login (IG-direct)' : 'Facebook Login'}
    >
      {isDirect ? 'IG Login' : 'FB Login'}
    </Badge>
  );
}
