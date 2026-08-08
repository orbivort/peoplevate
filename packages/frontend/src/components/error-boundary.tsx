import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI. When omitted a default full-screen alert is rendered. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Catches render errors from the subtree below it and renders a fallback UI
 * instead of crashing the whole application with a blank white screen.
 *
 * Wrap the root of the app and every lazy `<Suspense>` boundary so a failure in
 * one route never takes down the shared shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="mx-auto w-full max-w-md rounded-xl border border-ink-200 bg-white p-8 text-center shadow-sm">
          <div className="bg-danger-50 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <AlertTriangle className="h-6 w-6 text-danger-600" />
          </div>
          <h1 className="mt-4 font-display text-lg font-semibold tracking-tight text-ink-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {this.state.error?.message ?? 'An unexpected error occurred. Please try again.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-6 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-ink-900 px-4 text-sm font-medium text-ink-50 transition-all duration-200 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 focus-visible:outline-none active:bg-ink-950"
          >
            <RotateCcw className="size-4 shrink-0" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}
