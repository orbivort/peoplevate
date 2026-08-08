import { Field, Form, Formik, useFormikContext } from 'formik';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { BrandLogo } from '@/components/ui/brand-logo';
import { useAuth } from '@/contexts/auth-context';
import { validateEmail, validatePassword } from '@/lib/validation';

const demoAccounts = [
  { role: 'Admin', email: 'admin@example.com', password: 'Admin@12345!' },
  { role: 'HR Manager', email: 'hr@example.com', password: 'HR@12345!' },
  { role: 'Manager', email: 'manager@example.com', password: 'Manager@12345!' },
  { role: 'Employee', email: 'employee@example.com', password: 'Employee@12345!' },
];

interface LoginValues {
  email: string;
  password: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  return (
    <div className="grid min-h-screen bg-ink-50 lg:grid-cols-[1.1fr_1fr]">
      {/* Editorial side */}
      <div className="grain relative hidden flex-col justify-between overflow-hidden bg-ink-950 p-12 text-ink-50 lg:flex">
        {/* Ambient gradient mesh */}
        <div className="absolute inset-0 opacity-50">
          <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-accent-700/40 blur-[120px]" />
          <div className="absolute right-0 bottom-0 h-[28rem] w-[28rem] rounded-full bg-accent-900/60 blur-[120px]" />
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <BrandLogo className="h-9 w-9" />
          <span className="font-display text-xl tracking-tight">Peoplevate</span>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-4xl leading-[1.1] tracking-tight"
          >
            The complete employee lifecycle, on one auditable record.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="text-base leading-relaxed text-ink-300"
          >
            From first-day onboarding to final settlement — every change is logged, every permission
            enforced, every document tracked.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800"
          >
            {[
              ['100%', 'Audit coverage'],
              ['4', 'Role tiers'],
              ['6', 'Lifecycle modules'],
            ].map(([stat, label]) => (
              <div key={label} className="bg-ink-950 p-4">
                <div className="font-display text-2xl text-accent-400">{stat}</div>
                <div className="mt-1 text-xs text-ink-400">{label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="relative z-10 text-xs text-ink-500">
          Employee Lifecycle Management System · Self-hosted · v1.0
        </div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandLogo dark className="h-9 w-9" />
            <span className="font-display text-lg tracking-tight text-ink-900">ELMS</span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl tracking-tight text-ink-900">Welcome back</h2>
            <p className="mt-2 text-sm text-ink-500">Sign in to your account to continue.</p>
          </div>

          {serverError && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Formik<LoginValues>
            initialValues={{ email: '', password: '' }}
            validate={(values) => {
              const errors: Partial<Record<keyof LoginValues, string>> = {};
              const emailErr = validateEmail(values.email);
              if (emailErr) errors.email = emailErr;
              const pwErr = validatePassword(values.password);
              if (pwErr) errors.password = pwErr;
              return errors;
            }}
            onSubmit={async (values, { setSubmitting }) => {
              setServerError(null);
              const res = await login(values.email, values.password);
              setSubmitting(false);
              if (res.success) navigate('/app');
              else setServerError(res.error ?? 'Login failed.');
            }}
          >
            {({ isSubmitting, errors, touched }) => (
              <>
                <Form className="space-y-4">
                  <div>
                    <label htmlFor="email" className={inputLabel}>
                      Email address
                    </label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
                      <Field
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        className={inputWithIcon(Boolean(touched.email && errors.email))}
                      />
                    </div>
                    {touched.email && errors.email && <p className={errorText}>{errors.email}</p>}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className={inputLabel}>
                        Password
                      </label>
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium text-accent-700 hover:text-accent-800"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative mt-1.5">
                      <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
                      <Field
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className={inputWithIcon(Boolean(touched.password && errors.password))}
                      />
                    </div>
                    {touched.password && errors.password && (
                      <p className={errorText}>{errors.password}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink-900 text-sm font-medium text-ink-50 transition-all hover:bg-ink-800 active:scale-[0.99] disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-50/30 border-t-ink-50" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </button>
                </Form>

                {/* Demo accounts */}
                <DemoAccounts />
              </>
            )}
          </Formik>
        </motion.div>
      </div>
    </div>
  );
}

function DemoAccounts() {
  const { setFieldValue } = useFormikContext<LoginValues>();
  return (
    <div className="mt-8">
      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-ink-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-ink-50 px-3 text-xs text-ink-400">Demo accounts — click to fill</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {demoAccounts.map((acc) => (
          <button
            key={acc.email}
            type="button"
            onClick={() => {
              setFieldValue('email', acc.email, true);
              setFieldValue('password', acc.password, true);
            }}
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-left transition-colors hover:border-ink-300 hover:bg-ink-50"
          >
            <div className="text-xs font-medium text-ink-800">{acc.role}</div>
            <div className="mt-0.5 truncate text-[11px] text-ink-500">{acc.email}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const inputLabel = 'block text-sm font-medium text-ink-700';
const errorText = 'mt-1.5 text-xs text-red-600';

function inputWithIcon(hasError?: boolean) {
  return [
    'h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-sm text-ink-900 transition-colors placeholder:text-ink-400',
    'focus:outline-none focus:ring-2',
    hasError
      ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
      : 'border-ink-300 focus:border-accent-500 focus:ring-accent-500/20',
  ].join(' ');
}
