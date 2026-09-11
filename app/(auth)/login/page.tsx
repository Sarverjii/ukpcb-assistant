import { LoginForm } from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  // Set by app/api/auth/invalidate-session/route.ts — reached when a
  // still-valid session cookie belonged to a user who was since removed
  // or deactivated (see that route's own comment for the redirect loop
  // this replaces). Not set on an ordinary logout or a first-time visit.
  searchParams: Promise<{ sessionExpired?: string }>;
}) {
  const { sessionExpired } = await searchParams;
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
          {/* Plain <img>, not next/image: a static local asset gains nothing
              from Next's on-demand raster optimization, and this skips its
              image-domain config entirely. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Uttarakhand Pollution Control Board" className="h-14 w-auto" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            UKPCB Assistant
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Sign in with your Uttarakhand Pollution Control Board account
          </p>
        </div>

        {sessionExpired && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300"
          >
            Your session has ended. Please sign in again.
          </p>
        )}

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
