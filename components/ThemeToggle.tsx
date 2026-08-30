'use client';

import { useState, useTransition } from 'react';
import { Sun, Moon } from 'lucide-react';
import { updateThemePreferenceAction } from '@/app/(app)/actions';

/**
 * `initialTheme` MUST come from the server (the same AuthContext.
 * themePreference the layout already fetched), not from reading
 * document.documentElement at mount. During SSR, `document` doesn't exist
 * (Node has no DOM), so a `typeof document !== 'undefined'` guard always
 * evaluates false server-side regardless of the real theme — the server
 * would then always render this as "light", while the client's mount-time
 * read of the real DOM could correctly say "dark", producing a genuine
 * hydration mismatch. Taking the value as a prop keeps server and client
 * output identical from the first render.
 */
export function ThemeToggle({
  initialTheme,
  variant = 'menu',
}: {
  initialTheme: 'LIGHT' | 'DARK';
  variant?: 'menu' | 'icon';
}) {
  const [isDark, setIsDark] = useState(initialTheme === 'DARK');
  const [, startTransition] = useTransition();

  function setTheme(dark: boolean) {
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
    startTransition(async () => {
      await updateThemePreferenceAction(dark ? 'DARK' : 'LIGHT');
    });
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={() => setTheme(!isDark)}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        className="rounded-md p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200">
      <span>Theme</span>
      <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setTheme(false)}
          aria-pressed={!isDark}
          className={`flex items-center gap-1 px-2 py-1 text-xs ${
            !isDark
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Sun size={12} /> Light
        </button>
        <button
          type="button"
          onClick={() => setTheme(true)}
          aria-pressed={isDark}
          className={`flex items-center gap-1 px-2 py-1 text-xs ${
            isDark
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Moon size={12} /> Dark
        </button>
      </div>
    </div>
  );
}
