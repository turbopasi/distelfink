import { Component, Fragment, type ReactNode } from "react";

interface Props {
  /** Was ausgefallen ist, für die Meldung („Dieser Bereich", „Die Suche" …). */
  label: string;
  /** Wechselt der Inhalt (andere Szene, anderes Board), gilt der Fehler als
   *  erledigt — der neue Inhalt bekommt eine frische Chance. */
  resetKey?: string;
  /** Statt neu zu laden: z. B. einen Dialog schließen, der sonst sofort
   *  wieder an derselben Stelle scheiterte. */
  onDismiss?: () => void;
  dismissLabel?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Erhöht sich bei „neu laden" → Kinder werden neu aufgebaut. */
  generation: number;
  resetKey?: string;
}

/**
 * Fängt Renderfehler eines Bereichs ab. Ohne sie reißt ein Fehler in einem
 * einzelnen Panel die ganze Oberfläche mit — weißes Fenster. Ungespeicherter
 * Text liegt im Store, nicht in der Komponente, und bleibt erhalten.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, generation: 0, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error(`${this.props.label}: Renderfehler`, error, info.componentStack);
  }

  private reload = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  private dismiss = () => {
    this.setState({ error: null });
    this.props.onDismiss?.();
  };

  render() {
    const { error, generation } = this.state;
    if (!error) {
      return <Fragment key={generation}>{this.props.children}</Fragment>;
    }
    return (
      <div className="error-boundary" role="alert">
        <p>
          <strong>{this.props.label} ist auf einen Fehler gestoßen.</strong> Deine Texte sind davon
          nicht betroffen.
        </p>
        <p className="error-boundary-detail">{error.message}</p>
        <div className="error-boundary-actions">
          {this.props.onDismiss ? (
            <button onClick={this.dismiss}>{this.props.dismissLabel ?? "Schließen"}</button>
          ) : (
            <button onClick={this.reload}>Bereich neu laden</button>
          )}
        </div>
      </div>
    );
  }
}
