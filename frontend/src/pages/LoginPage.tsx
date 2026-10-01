import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('user@demo.com');
  const [password, setPassword] = useState('user123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      const requestedPath = (location.state as { from?: string } | null)?.from;
      navigate(requestedPath?.startsWith('/') ? requestedPath : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auth failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md animate-slideIn">
      <h1 className="font-display text-3xl font-extrabold text-sand-50">
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </h1>
      <p className="mt-2 text-sm text-sand-300">
        Demo: <span className="font-mono text-ember-400">user@demo.com</span> /{' '}
        <span className="font-mono text-ember-400">user123</span> · admin{' '}
        <span className="font-mono">admin@demo.com</span> /{' '}
        <span className="font-mono">admin123</span>
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
        {mode === 'register' && (
          <Field label="Name" value={name} onChange={setName} required />
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          required
        />

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-ember-500 py-2.5 font-medium text-ink-950 hover:bg-ember-400 disabled:opacity-60"
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register'}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-sand-300 hover:text-ember-400"
        onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
      >
        {mode === 'login'
          ? 'Need an account? Register'
          : 'Already registered? Sign in'}
      </button>

      <p className="mt-6">
        <Link to="/" className="text-sm text-sand-300 hover:text-ember-400">
          ← Back to events
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-sand-300">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-sand-50 outline-none focus:border-ember-400"
      />
    </label>
  );
}
