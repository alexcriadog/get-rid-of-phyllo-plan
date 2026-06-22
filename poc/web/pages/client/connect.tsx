// /client/connect
//   - With ?req=<authReq JWT> (sent here by the connector's /mcp/oauth/authorize):
//     the OAuth consent screen. Requires a logged-in /client session; otherwise
//     bounces through /client/login?return_to=… (no second login — reuses the
//     existing session). "Allow" POSTs to /api/client/mcp-authorize.
//   - Without ?req: a setup/info page showing the connector URL + steps to add
//     it as a custom connector in Claude/ChatGPT.

import type { GetServerSideProps, NextApiRequest } from 'next';
import { Sparkles, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { readApiKeyFromRequest } from '@/lib/client-session';
import { verifyHandoffJwt, handoffSecret } from '@/lib/oauth-handoff';

const MCP_URL =
  process.env.MCP_PUBLIC_BASE_URL || 'https://smconnector.camaleonicanalytics.com';

type Props =
  | { mode: 'info' }
  | { mode: 'consent'; req: string; scope: string };

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const req = typeof ctx.query.req === 'string' ? ctx.query.req : '';
  if (!req) {
    return { props: { mode: 'info' } };
  }
  const apiKey = readApiKeyFromRequest(ctx.req as unknown as NextApiRequest);
  if (!apiKey) {
    const back = `/client/connect?req=${encodeURIComponent(req)}`;
    return {
      redirect: {
        destination: `/client/login?return_to=${encodeURIComponent(back)}`,
        permanent: false,
      },
    };
  }
  const claims = verifyHandoffJwt<{ scope?: string }>(req, handoffSecret());
  const scope =
    claims && typeof claims.scope === 'string' ? claims.scope : 'social:read';
  return { props: { mode: 'consent', req, scope } };
};

export default function ConnectPage(props: Props) {
  if (props.mode === 'info') {
    return (
      <Shell>
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="text-base font-semibold">Connect an AI assistant</div>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect Claude or ChatGPT to read your workspace&apos;s social
          analytics. In your assistant, add a <strong>custom connector</strong>{' '}
          with this URL and authentication set to <strong>OAuth</strong>:
        </p>
        <pre className="mt-3 select-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          {`${MCP_URL}/mcp`}
        </pre>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Open your assistant&apos;s Connectors settings (ChatGPT: enable
            Developer mode).
          </li>
          <li>
            Add a custom connector, paste the URL above, choose Authentication:
            OAuth.
          </li>
          <li>
            You&apos;ll be sent back here to approve access — one click, no new
            login.
          </li>
        </ol>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="text-base font-semibold">Authorize AI assistant</div>
      </div>
      <p className="text-sm text-muted-foreground">
        An AI assistant (e.g. Claude or ChatGPT) is requesting{' '}
        <strong>read-only</strong> access to your workspace&apos;s social
        analytics.
      </p>
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Scope: <code className="font-mono">{props.scope}</code> — list accounts,
        posts, metrics, audience and comments. It cannot publish or change
        anything.
      </div>
      <form
        method="POST"
        action="/api/client/mcp-authorize"
        className="mt-5 flex gap-2"
      >
        <input type="hidden" name="req" value={props.req} />
        <Button type="submit" className="flex-1">
          Allow
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => {
            window.location.href = '/client';
          }}
        >
          Deny
        </Button>
      </form>
      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        You can revoke access at any time from your assistant&apos;s connector
        settings.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">{children}</CardContent>
      </Card>
    </div>
  );
}
