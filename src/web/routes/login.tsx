import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { AuthLayout, FormError } from '@web/components/shell/auth-layout';
import { Button } from '@web/components/ui/button';
import { Field } from '@web/components/ui/field';
import { api, ApiError, errorMessage } from '@web/lib/api';
import { keys, meQuery, setupQuery } from '@web/lib/queries';

const search = z.object({
  // Only same-origin paths, never a full URL (no open redirects).
  next: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/login')({
  validateSearch: search,
  beforeLoad: async ({ context: { queryClient } }) => {
    if ((await queryClient.ensureQueryData(setupQuery)).needsSetup) throw redirect({ to: '/setup' });
    if (await queryClient.ensureQueryData(meQuery)) throw redirect({ to: '/' });
  },
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setError(null);
    setPending(true);
    try {
      await api('/api/auth/sign-in/email', { body: { email: email.trim(), password } });
      // Drop the cached "signed out" result so the route guard fetches the new session.
      qc.removeQueries({ queryKey: keys.me });
      // A next with a query (the OAuth consent screen) needs a full load to keep its query.
      if (next?.includes('?')) location.assign(next);
      else await navigate({ to: next ?? '/' });
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 401) setError("That email and password don't match.");
      else if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else setError(errorMessage(err));
    }
  }

  return (
    <AuthLayout title="Sign in to Notey" subtitle="Welcome back.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          inputMode="email"
          autoFocus
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Button type="submit" variant="primary" loading={pending} className="mt-2 w-full justify-center">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
