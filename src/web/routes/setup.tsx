import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { setupInput, type Workspace } from '@shared/schemas';
import { AuthLayout, FormError } from '@web/components/shell/auth-layout';
import { Button } from '@web/components/ui/button';
import { Field } from '@web/components/ui/field';
import { api, errorMessage } from '@web/lib/api';
import { keys, setupQuery } from '@web/lib/queries';
import { rememberWorkspace } from '@web/lib/workspace-memory';

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context: { queryClient } }) => {
    if (!(await queryClient.ensureQueryData(setupQuery)).needsSetup) throw redirect({ to: '/login' });
  },
  component: Setup,
});

type Errors = Partial<Record<'name' | 'email' | 'password' | 'workspaceName', string>>;

const MESSAGES: Required<Errors> = {
  name: 'Enter your name.',
  email: 'Enter a valid email address.',
  password: 'Use at least 10 characters.',
  workspaceName: 'Name your first workspace.',
};

function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: 'Personal' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = setupInput.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof Errors;
        next[k] ??= MESSAGES[k];
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const { workspace } = await api<{ workspace: Workspace }>('/api/setup', { body: parsed.data });
      rememberWorkspace(workspace.id);
      qc.setQueryData(keys.setup, { needsSetup: false });
      qc.removeQueries({ queryKey: keys.me });
      await navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.id } });
    } catch (err) {
      setFormError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthLayout title="Set up Notey" subtitle="Create the owner account. You're the only person who can sign in here.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={formError} />
        <Field label="Your name" value={form.name} onChange={set('name')} autoComplete="name" autoFocus error={errors.name} />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          inputMode="email"
          error={errors.email}
        />
        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.password}
        />
        <Field
          label="First workspace"
          value={form.workspaceName}
          onChange={set('workspaceName')}
          autoComplete="off"
          hint="You can rename it and add more later."
          error={errors.workspaceName}
        />
        <Button type="submit" variant="primary" loading={pending} className="mt-2 w-full justify-center">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
