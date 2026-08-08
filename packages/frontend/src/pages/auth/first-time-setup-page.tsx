import { Field, Form, Formik } from 'formik';
import { motion } from 'framer-motion';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { validatePasswordMatch, validatePasswordPolicy } from '@/lib/validation';

interface SetupValues {
  password: string;
  confirmPassword: string;
}

const policyRules = [
  { label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { label: 'One special character', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export function FirstTimeSetupPage() {
  const navigate = useNavigate();
  const [pw, setPw] = useState('');

  return (
    <div className="bg-dots flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="font-display text-lg tracking-tight text-ink-900">Account Setup</span>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-8 shadow-lg">
          <h1 className="font-display text-2xl tracking-tight text-ink-900">Set your password</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your administrator has created your account. Choose a secure password to activate it.
          </p>

          <Formik<SetupValues>
            initialValues={{ password: '', confirmPassword: '' }}
            validate={(values) => {
              const errors: Partial<Record<keyof SetupValues, string>> = {};
              const pwErr = validatePasswordPolicy(values.password);
              if (pwErr) errors.password = pwErr;
              const matchErr = validatePasswordMatch(values.confirmPassword, values.password);
              if (matchErr) errors.confirmPassword = matchErr;
              return errors;
            }}
            onSubmit={async (_values, { setSubmitting }) => {
              await new Promise((r) => setTimeout(r, 800));
              setSubmitting(false);
              navigate('/login');
            }}
          >
            {({ isSubmitting, errors, touched, values }) => (
              <Form className="mt-6 space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                    New password
                  </label>
                  <Field
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    onInput={(e: React.ChangeEvent<HTMLInputElement>) => setPw(e.target.value)}
                    className={[
                      'mt-1.5 h-11 w-full rounded-lg border bg-white px-3 text-sm text-ink-900 transition-colors placeholder:text-ink-400',
                      'focus:ring-2 focus:outline-none',
                      touched.password && errors.password
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-ink-300 focus:border-accent-500 focus:ring-accent-500/20',
                    ].join(' ')}
                  />
                  {/* Live policy checklist */}
                  <ul className="mt-3 space-y-1.5">
                    {policyRules.map((rule) => {
                      const ok = rule.test(pw || values.password);
                      return (
                        <li
                          key={rule.label}
                          className={`flex items-center gap-2 text-xs transition-colors ${
                            ok ? 'text-accent-700' : 'text-ink-400'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                              ok ? 'bg-accent-100' : 'bg-ink-100'
                            }`}
                          >
                            {ok && <Check className="h-2.5 w-2.5" />}
                          </span>
                          {rule.label}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="block text-sm font-medium text-ink-700"
                  >
                    Confirm password
                  </label>
                  <Field
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={[
                      'mt-1.5 h-11 w-full rounded-lg border bg-white px-3 text-sm text-ink-900 transition-colors placeholder:text-ink-400',
                      'focus:ring-2 focus:outline-none',
                      touched.confirmPassword && errors.confirmPassword
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-ink-300 focus:border-accent-500 focus:ring-accent-500/20',
                    ].join(' ')}
                  />
                  {touched.confirmPassword && errors.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-600">{errors.confirmPassword}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-600 text-sm font-medium text-white transition-all hover:bg-accent-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Activating…
                    </>
                  ) : (
                    <>
                      Activate account
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </Form>
            )}
          </Formik>
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          Already set up?{' '}
          <Link to="/login" className="font-medium text-accent-700 hover:text-accent-800">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
