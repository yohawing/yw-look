import { Component, type ErrorInfo, type ReactNode } from "react";
import { openAppLogDir } from "../lib/diagnostics";
import { logFrontendFatal } from "../lib/runtimeLogging";
import "../styles/error-boundary.css";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
  info: ErrorInfo | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    info: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    logFrontendFatal(
      `${error.name}: ${error.message}\n${error.stack ?? ""}\n${info.componentStack}`,
      "react-error-boundary",
    );
  }

  render() {
    const { error, info } = this.state;
    if (!error) {
      return this.props.children;
    }

    const details = [
      `${error.name}: ${error.message}`,
      error.stack ?? "",
      info?.componentStack ?? "",
    ]
      .filter(Boolean)
      .join("\n");

    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-boundary__panel">
          <p className="app-error-boundary__label">Fatal UI Error</p>
          <h1>yw-look hit a render error.</h1>
          <p>
            The error was written to the local log. Reload the app, copy the
            details, or open the log folder for a bug report.
          </p>
          <div className="app-error-boundary__actions">
            <button onClick={() => window.location.reload()} type="button">
              Reload
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(details);
              }}
              type="button"
            >
              Copy Details
            </button>
            <button onClick={() => void openAppLogDir()} type="button">
              Open Logs
            </button>
          </div>
          <pre>{details}</pre>
        </section>
      </main>
    );
  }
}
