import Link from 'next/link';
import { Building2, ArrowUpRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLive, POLL } from '../lib/useLive';
import { useWorkspaceFilter } from '../lib/workspace-context';

const ALL_VALUE = '__all__';

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
}

/**
 * Topbar Tenant Switcher. Two jobs:
 *  1. Filter — persists the selected slug through WorkspaceContext and
 *     exposes it to global pages via `withQuery`. Defaults to "All workspaces".
 *  2. Navigate — when a tenant is selected, the adjacent "open" affordance
 *     jumps into that workspace's hub (`/admin/workspaces/[slug]`), which is
 *     otherwise only reachable from the workspaces list. First step toward
 *     treating a workspace as an object you go *into*, not just a filter.
 *
 * Polls the list cheaply so newly-created workspaces appear without a reload.
 */
export default function WorkspaceSelect() {
  const { slug, set } = useWorkspaceFilter();
  const list = useLive<WorkspaceRow[]>('/admin/workspaces', POLL.catalog);

  const value = slug ?? ALL_VALUE;
  const handleChange = (next: string) => {
    set(next === ALL_VALUE ? null : next);
  };

  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger className="h-8 gap-2 px-3 text-xs">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="text-xs">
          <SelectItem value={ALL_VALUE}>All workspaces</SelectItem>
          {(list.data ?? []).map((ws) => (
            <SelectItem key={ws.id} value={ws.slug}>
              {ws.name}
              <span className="ml-2 text-muted-foreground/70">/{ws.slug}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {slug && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Link href={`/admin/workspaces/${slug}`} aria-label="Open workspace hub">
                <ArrowUpRight />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open workspace hub</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
