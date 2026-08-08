import { Field, Form, Formik } from 'formik';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { validateEmail } from '@/lib/validation';

interface ForgotValues {
  email: string;
}

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="bg-dots flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <Link
          to="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="rounded-2xl border border-ink-200 bg-white p-8 shadow-lg">
          {submitted ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-100">
                <CheckCircle2 className="h-7 w-7 text-accent-600" />
              </div>
              <h1 className="mt-5 font-display text-2xl tracking-tight text-ink-900">
                Check your email
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                If an account exists for that address, we've sent a password reset link valid for 1
                hour.
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-6 text-sm font-medium text-accent-700 hover:text-accent-800"
              >
                Didn't receive it? Try again
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl tracking-tight text-ink-900">
                Reset your password
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <Formik<ForgotValues>
                initialValues={{ email: '' }}
                validate={(values) => {
                  const errors: Partial<Record<keyof ForgotValues, string>> = {};
                  const err = validateEmail(values.email);
                  if (err) errors.email = err;
                  return errors;
                }}
                onSubmit={async (_values, { setSubmitting }) => {
                  await new Promise((r) => setTimeout(r, 700));
                  setSubmitting(false);
                  setSubmitted(true);
                }}
              >
                {({ isSubmitting, errors, touched }) => (
                  <Form className="mt-6 space-y-4">
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-ink-700">
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
                          className={[
                            'h-11 w-full rounded-lg border bg-white pr-3 pl-10 text-sm text-ink-900 transition-colors placeholder:text-ink-400',
                            'focus:ring-2 focus:outline-none',
                            touched.email && errors.email
                              ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                              : 'border-ink-300 focus:border-accent-500 focus:ring-accent-500/20',
                          ].join(' ')}
                        />
                      </div>
                      {touched.email && errors.email && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.email}</p>
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
                          Sending link…
                        </>
                      ) : (
                        <>
                          Send reset link
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </button>
                  </Form>
                )}
              </Formik>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
