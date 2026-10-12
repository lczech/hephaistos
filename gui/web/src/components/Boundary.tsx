import { Component, type ReactNode } from "react";
import styles from "./Boundary.module.css";

interface Props {
  children: ReactNode;
  hint?: string | null; // e.g. that the GUI and the Daemon differ in version
}

interface State {
  error: Error | null;
}

/** Keeps a part that fails from taking the rest of the page with it. */
export class Boundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <section className={styles.failed} role="alert">
        <p>Couldn't show this: {this.state.error.message}</p>
        {this.props.hint && <p>{this.props.hint}</p>}
      </section>
    );
  }
}
