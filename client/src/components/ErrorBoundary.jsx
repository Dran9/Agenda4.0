import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[app] Render error caught by ErrorBoundary', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#F6F1E8',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              borderRadius: '24px',
              padding: '28px 24px',
              background: '#FFFFFF',
              boxShadow: '0 20px 60px rgba(33, 37, 41, 0.08)',
              textAlign: 'center',
            }}
          >
            <h1 style={{ margin: '0 0 12px', fontSize: '28px', lineHeight: 1.15, color: '#1A1A17' }}>
              Ocurrio un error inesperado
            </h1>
            <p style={{ margin: '0 0 18px', fontSize: '18px', lineHeight: 1.5, color: '#4E6275' }}>
              La pagina fallo al renderizar. Recarga para volver a intentarlo sin quedar en blanco.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: 'none',
                borderRadius: '999px',
                padding: '14px 22px',
                fontSize: '16px',
                fontWeight: 600,
                color: '#FFFFFF',
                background: '#4E769B',
                cursor: 'pointer',
              }}
            >
              Recargar pagina
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
