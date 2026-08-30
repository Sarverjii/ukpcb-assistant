'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth/auth.config';

export type LoginState = { error?: string };

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/chat',
    });
    return {};
  } catch (error) {
    // signIn() with redirectTo throws a framework-internal redirect on
    // success — only AuthError means the credentials were actually rejected.
    // Anything else must be rethrown so the redirect (or other framework
    // control flow) still happens.
    if (error instanceof AuthError) {
      return { error: 'Invalid email or password.' };
    }
    throw error;
  }
}
