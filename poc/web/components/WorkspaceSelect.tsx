import { Building2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLive } from '../lib/useLive';
import { useWorkspaceFilter } from '../lib/workspace-context';

const ALL_VALUE = '__all__';

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
}

/**
 * Topbar workspace selector. Fetches the workspace list every 30s (cheap)
 * so newly-created workspaces appear without a hard reload. Persists the
 * selection through WorkspaceContext.
 */
export default function WorkspaceSelect() {
  const { slug, set } = useWorkspaceFilter();
  const list = useLive<WorkspaceRow[]>('/admin/workspaces', 30_000);

  const value = slug ?? ALL_VALUE;
  const handleChange = (next: string) => {
    set(next === ALL_VALUE ? null : next);
  };

  return (
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
  );
}
