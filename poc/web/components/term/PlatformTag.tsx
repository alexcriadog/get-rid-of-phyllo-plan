import { cn } from '@/lib/utils';
import { platformTag } from '@/lib/term/platforms';

interface PlatformTagProps {
  platform: string;
  showLabel?: boolean;
  className?: string;
}

export default function PlatformTag({ platform, showLabel = false, className }: PlatformTagProps) {
  const spec = platformTag(platform);
  return (
    <span
      title={spec.label}
      className={cn('whitespace-nowrap font-mono text-xs', spec.className, className)}
    >
      {showLabel ? `[${spec.abbr}] ${spec.label}` : `[${spec.abbr}]`}
    </span>
  );
}
