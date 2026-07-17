import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

/**
 * Non-blocking error boundary — shows a dismissible error toast
 * instead of replacing the entire UI with a blank error screen.
 * "Réessayer" resets the error state and re-renders children.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <>
          {/* Try rendering children anyway — if they crash again,
              getDerivedStateFromError will catch it */}
          {this.props.children}
          {/* Error toast overlay */}
          <div
            className="animate-notif"
            style={{
              position: "fixed",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 99998,
              maxWidth: 480,
              width: "calc(100% - 48px)",
              background: "#1a1a1a",
              color: "#f5f5f5",
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              padding: "16px 20px",
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              {/* Error icon */}
              <div
                style={{
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "white",
                  marginTop: 1,
                }}
              >
                !
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Une erreur est survenue
                </div>
                <div
                  style={{
                    color: "#a3a3a3",
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: this.state.showDetails ? "pre-wrap" : "nowrap",
                    wordBreak: "break-word",
                  }}
                >
                  {this.state.error?.message || "Erreur inconnue"}
                </div>
                {this.state.error?.stack && (
                  <button
                    onClick={() =>
                      this.setState((s) => ({ showDetails: !s.showDetails }))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: "#737373",
                      fontSize: 12,
                      padding: 0,
                      marginTop: 4,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {this.state.showDetails ? "Masquer" : "Détails"}
                  </button>
                )}
                {this.state.showDetails && this.state.error?.stack && (
                  <pre
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "#737373",
                      maxHeight: 120,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                onClick={this.handleDismiss}
                style={{
                  background: "#262626",
                  color: "#a3a3a3",
                  border: "1px solid #404040",
                  borderRadius: 8,
                  padding: "6px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Fermer
              </button>
              <button
                onClick={this.handleRetry}
                style={{
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Réessayer
              </button>
            </div>
          </div>
        </>
      );
    }

    return this.props.children;
  }
}
