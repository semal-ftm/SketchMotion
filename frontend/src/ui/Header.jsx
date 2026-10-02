import { StatusPill } from './primitives.jsx';

export function Header({ api }) {
  const tone = api.status === 'ok' ? 'ok' : api.status === 'checking' ? 'info' : 'error';
  const label =
    api.status === 'ok' ? `OpenCV ${api.opencv} ready` : api.status === 'checking' ? 'Connecting to API…' : 'Extraction API offline';
  return (
    <header className="app-header">
      <div className="brand">
        <img className="logo" src="/logo.png" alt="" width="42" height="42" />
        <div>
          <h1>SketchMotion</h1>
          <p className="tagline">Bring your drawings to life</p>
        </div>
      </div>
      <div className="header-meta">
        <StatusPill tone={tone} pulse={api.status === 'checking'}>
          {label}
        </StatusPill>
      </div>
    </header>
  );
}
