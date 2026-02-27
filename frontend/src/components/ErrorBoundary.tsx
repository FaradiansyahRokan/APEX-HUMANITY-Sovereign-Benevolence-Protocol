/**
 * APEX HUMANITY — ErrorBoundary Component
 *
 * React class-based error boundary that catches render/lifecycle errors
 * in any child subtree and renders a graceful fallback UI.
 *
 * Usage:
 *   <ErrorBoundary context="Oracle">
 *     <SubmitImpactForm />
 *   </ErrorBoundary>
 */

"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
    children: ReactNode;
    /** Optional label shown in the error card header, e.g. "Oracle" or "Feed" */
    context?: string;
    /** Optional callback — fires when an error is caught */
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[APEX ErrorBoundary]", error, info);
        this.props.onError?.(error, info);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        const context = this.props.context ?? "Component";
        const message = this.state.error?.message ?? "Unknown error";

        return (
            <div style={styles.overlay}>
                <div style={styles.card}>
                    {/* Header */}
                    <div style={styles.header}>
                        <span style={styles.icon}>⚠️</span>
                        <span style={styles.title}>{context} — Something went wrong</span>
                    </div>

                    {/* Body */}
                    <p style={styles.description}>
                        An unexpected error occurred. This is likely a temporary issue.
                    </p>

                    <div style={styles.errorBox}>
                        <code style={styles.errorText}>{message}</code>
                    </div>

                    {/* Actions */}
                    <div style={styles.actions}>
                        <button style={styles.retryBtn} onClick={this.handleRetry}>
                            🔄 Try Again
                        </button>
                        <button
                            style={styles.reloadBtn}
                            onClick={() => window.location.reload()}
                        >
                            ↩ Reload Page
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

// ── Inline styles (glassmorphism — matches APEX design system) ───────────────

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "200px",
        padding: "24px",
        width: "100%",
    },
    card: {
        background: "rgba(15, 20, 40, 0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255, 80, 80, 0.35)",
        borderRadius: "16px",
        padding: "28px 32px",
        maxWidth: "480px",
        width: "100%",
        boxShadow: "0 8px 32px rgba(255, 60, 60, 0.15)",
        animation: "fadeInUp 0.3s ease",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "14px",
    },
    icon: {
        fontSize: "22px",
    },
    title: {
        fontSize: "16px",
        fontWeight: 700,
        color: "#ff6b6b",
        fontFamily: "'Inter', sans-serif",
        letterSpacing: "0.01em",
    },
    description: {
        color: "rgba(220, 220, 255, 0.75)",
        fontSize: "14px",
        lineHeight: "1.6",
        marginBottom: "16px",
        fontFamily: "'Inter', sans-serif",
    },
    errorBox: {
        background: "rgba(255, 60, 60, 0.08)",
        border: "1px solid rgba(255, 60, 60, 0.2)",
        borderRadius: "8px",
        padding: "10px 14px",
        marginBottom: "20px",
        overflowX: "auto",
    },
    errorText: {
        color: "#ff9e9e",
        fontSize: "12px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        wordBreak: "break-word",
    },
    actions: {
        display: "flex",
        gap: "12px",
        flexWrap: "wrap",
    },
    retryBtn: {
        flex: 1,
        padding: "10px 20px",
        background: "linear-gradient(135deg, #6c63ff 0%, #a855f7 100%)",
        border: "none",
        borderRadius: "10px",
        color: "#fff",
        fontWeight: 600,
        fontSize: "14px",
        cursor: "pointer",
        fontFamily: "'Inter', sans-serif",
        transition: "opacity 0.2s",
    },
    reloadBtn: {
        flex: 1,
        padding: "10px 20px",
        background: "rgba(255, 255, 255, 0.07)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "10px",
        color: "rgba(220, 220, 255, 0.85)",
        fontWeight: 600,
        fontSize: "14px",
        cursor: "pointer",
        fontFamily: "'Inter', sans-serif",
        transition: "background 0.2s",
    },
};

export default ErrorBoundary;
