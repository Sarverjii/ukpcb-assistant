import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-50 dark:bg-zinc-950 px-4">
      {/* Subtle brand-tinted glow — enterprise-app polish without a busy background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(600px circle at 50% -10%, color-mix(in srgb, var(--color-brand-500) 14%, transparent), transparent 60%)',
        }}
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Plain <img>, not next/image: Next's image optimizer blocks SVG
              by default (a security default, since SVGs can carry script) —
              and a static SVG gains nothing from raster optimization anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Evon" className="h-14 w-auto" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            Ask Evon
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Sign in with your company account
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.15)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_-16px_rgba(0,0,0,0.5)]">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          Access is limited to authorized employees. Contact your administrator for an account.
        </p>
      </div>
    </main>
  );
}
