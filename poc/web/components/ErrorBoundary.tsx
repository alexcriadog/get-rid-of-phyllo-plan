import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Optional label so the message can name the surface that failed. */
  surface?: string;
}

interface State {
  error: Error | null;
}

/**
 * App-level boundary mounted around the admin content area. Catches render
 * errors so a single broken screen degrades to a recoverable panel instead
 * of a blank page. Pages no longer need to hand-roll catch-all error UI.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[admin] render error', error, info.componentStack);
    }
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl py-16">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-6">
          <div className="mb-3 flex items-center gap-2 text-danger">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-sm font-semibold">
              {this.props.surface ?? 'This screen'} hit an error
            </h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            The view failed to render. The rest of the console is still
            usable — retry, or navigate elsewhere.
          </p>
          <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] text-muted-foreground">
            {error.message}
          </pre>
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }
}
