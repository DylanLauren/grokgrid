import { Component, type ReactNode } from 'react'

// Shows `fallback` instead of a blank screen when something below throws (no WebGL, a lost context).
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.error(e)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
