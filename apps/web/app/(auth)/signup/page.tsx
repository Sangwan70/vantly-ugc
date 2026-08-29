// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { redirect } from 'next/navigation';

/**
 * Signup is no longer a separate page.
 * OTP login auto-creates accounts, so redirect to /login.
 */
export default function SignupPage() {
  redirect('/login');
}
