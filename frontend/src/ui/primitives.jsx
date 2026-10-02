import { forwardRef, useId } from 'react';
import { Loader2 } from 'lucide-react';

export const Button = forwardRef(function Button(
  { variant = 'soft', icon: Icon, children, className = '', busy = false, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" className={`btn btn-${variant} ${className}`} aria-busy={busy || undefined} {...rest}>
      {busy ? <Loader2 className="spin" size={18} aria-hidden /> : Icon && <Icon size={18} aria-hidden />}
      {children && <span>{children}</span>}
    </button>
  );
});

/** Icon-only button: always has an accessible label and a tooltip. */
export function IconButton({ icon: Icon, label, className = '', ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={18} aria-hidden />
    </button>
  );
}

export function Card({ title, icon: Icon, step, actions, children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-head">
          {step != null && <span className="step-badge" aria-hidden>{step}</span>}
          {Icon && !step && <Icon size={18} className="card-icon" aria-hidden />}
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Slider({ label, value, min, max, step = 1, format = (v) => v, onChange, disabled, hint }) {
  const id = useId();
  return (
    <div className={`field slider ${disabled ? 'is-disabled' : ''}`}>
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint, disabled }) {
  const id = useId();
  return (
    <div className={`field toggle ${disabled ? 'is-disabled' : ''}`}>
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          className={`switch ${checked ? 'on' : ''}`}
          onClick={() => onChange(!checked)}
        >
          <span className="knob" />
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Accessible segmented control (radio group with arrow-key support). */
export function Segmented({ label, options, value, onChange, size = 'md' }) {
  const onKey = (e) => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(options[(i + 1) % options.length].value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(options[(i - 1 + options.length) % options.length].value);
    }
  };
  return (
    <div className={`segmented seg-${size}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'active' : ''}
            onClick={() => onChange(o.value)}
            title={o.title}
          >
            {Icon && <Icon size={16} aria-hidden />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StatusPill({ tone = 'neutral', children, pulse = false }) {
  return (
    <span className={`pill pill-${tone}`} role="status">
      <span className={`dot ${pulse ? 'pulse' : ''}`} aria-hidden />
      {children}
    </span>
  );
}

export function Callout({ tone = 'info', icon: Icon, title, children }) {
  return (
    <div className={`callout callout-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {Icon && <Icon size={18} className="callout-icon" aria-hidden />}
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
