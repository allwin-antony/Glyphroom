import React, { Component, type ErrorInfo, type ReactNode } from 'react';

export interface PluginErrorBoundaryProps {
  pluginId: string;
  slot: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface PluginErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[PluginErrorBoundary] Render crash isolated in plugin "${this.props.pluginId}" for slot "${this.props.slot}":`,
      error,
      errorInfo
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      // Fail safely by rendering nothing for the broken plugin contribution
      return null;
    }

    return this.props.children;
  }
}
