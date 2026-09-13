import { t } from "../lib/i18n";
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
          <p className="app-error-boundary__label">{t("fatal.label")}</p>
          <h1>{t("fatal.title")}</h1>
          <p>{t("fatal.body")}</p>
          <div className="app-error-boundary__actions">
            <button onClick={() => window.location.reload()} type="button">
              {t("reload")}
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(details);
              }}
              type="button"
            >
              {t("copy_details")}
            </button>
            <button onClick={() => void openAppLogDir()} type="button">
              {t("open_logs")}
            </button>
          </div>
          <pre>{details}</pre>
        </section>
      </main>
    );
  }
}
