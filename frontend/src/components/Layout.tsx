import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 backdrop-blur-md sticky top-0 z-30 bg-ink-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold tracking-tight text-sand-50 sm:text-3xl">
              TicketMaster
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.2em] text-ember-400 sm:inline">
              Tickets
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-body">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? 'text-ember-400' : 'text-sand-300 hover:text-sand-50'
              }
            >
              Discover
            </NavLink>
            <NavLink
              to="/lab"
              className={({ isActive }) =>
                isActive ? 'text-ember-400' : 'text-sand-300 hover:text-sand-50'
              }
            >
              System Lab
            </NavLink>
            {user ? (
              <>
                <span className="hidden text-sand-300 sm:inline">{user.name}</span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md border border-white/15 px-3 py-1.5 text-sand-100 hover:border-ember-400/50 hover:text-ember-400"
                >
                  Log out
                </button>
              </>
            ) : (
              <NavLink
                to="/login"
                className="rounded-md bg-ember-500 px-3 py-1.5 font-medium text-ink-950 hover:bg-ember-400"
              >
                Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
