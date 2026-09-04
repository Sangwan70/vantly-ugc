/**
 * Shared handler for the `checkout` Edge Function's response, used by
 * every page that starts a checkout (subscribe, onboarding/plan, and both
 * billing pages -- previously each duplicated its own
 * `if (data?.checkout_url) window.location.href = ...` block).
 *
 * Centralizing this here is what let the RazorPay gateway get added
 * without touching 4 separate page files beyond a couple of lines each:
 * the Stripe response shape (`checkout_url`) is unchanged and still just
 * redirects; a RazorPay response (`razorpay_subscription_id` or
 * `razorpay_order_id`) instead lazy-loads RazorPay's Checkout.js and opens
 * its modal -- nothing else in the calling page needs to know which
 * gateway is active.
 *
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Vantly UGC contributors
 */

export interface CheckoutResponse {
  checkout_url?: string;
  client_secret?: string;
  session_id?: string;
  upgraded?: boolean;
  payment_gateway?: "stripe" | "razorpay";
  razorpay_subscription_id?: string;
  razorpay_order_id?: string;
  razorpay_key_id?: string;
  amount_paise?: number;
  credits?: number;
  plan_tier?: string;
  error?: string;
  error_description?: string;
}

/**
 * Where the browser ends up after a RazorPay Checkout.js attempt concludes.
 * Defaults to the SAME fixed destination Stripe's own checkout already
 * redirects to server-side today (`${SITE_URL}/billing?status=success` /
 * `?status=canceled` -- see checkout/index.ts's createSubscriptionCheckout
 * and createDynamicPaygCheckout, neither of which take a caller-supplied
 * URL), so every call site gets consistent behavior across both gateways
 * without having to pass its own URLs. Override only if a specific page
 * genuinely needs a different destination.
 *
 * Without this, RazorPay's `handler`/`modal.ondismiss` do nothing once the
 * modal closes -- the user is left staring at a closed modal with no
 * feedback while the real credit grant is still catching up via webhook.
 * (Confirmed against AutoGPT's own platform frontend,
 * src/lib/payments/razorpayCheckout.ts, which navigates on both outcomes
 * for exactly this reason -- see that file's 2026-08-05 docstring.)
 */
const DEFAULT_SUCCESS_PATH = "/billing?status=success";
const DEFAULT_CANCEL_PATH = "/billing?status=canceled";

export interface OpenCheckoutOptions {
  /** Called once RazorPay's own Checkout.js reports success (subscription authorized / payment captured), BEFORE navigating to successPath. Actual crediting always happens server-side via webhook-razorpay -- this is for anything extra a page wants to do (e.g. analytics), not a replacement for the navigation. */
  onRazorpaySuccess?: (response: { razorpay_payment_id: string }) => void;
  /** Called if the user closes the RazorPay modal without paying, BEFORE navigating to cancelPath. */
  onRazorpayDismiss?: () => void;
  /** Where to navigate after a successful RazorPay payment. Defaults to DEFAULT_SUCCESS_PATH (matches Stripe's own fixed success_url). Pass null to disable navigation entirely (e.g. if a page wants to stay put and just refetch). */
  successPath?: string | null;
  /** Where to navigate after the user closes the RazorPay modal without paying. Defaults to DEFAULT_CANCEL_PATH (matches Stripe's own fixed cancel_url). Pass null to disable navigation. */
  cancelPath?: string | null;
  /** Display name shown in the RazorPay Checkout modal header. */
  productName?: string;
  /** User's email/contact, prefilled into RazorPay Checkout for convenience. */
  prefill?: { email?: string; name?: string };
}

// ─── RazorPay Checkout.js loader ────────────────────────────────────────────

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) {
    return Promise.resolve();
  }
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load RazorPay Checkout")));
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load RazorPay Checkout"));
    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Handle a response from the `checkout` Edge Function, regardless of which
 * gateway produced it. Returns `true` if it recognized and acted on the
 * response, `false` if the caller should fall back to its own
 * error-handling (e.g. an `{ error, error_description }` body).
 */
export async function openCheckoutResponse(
  data: CheckoutResponse | null | undefined,
  options: OpenCheckoutOptions = {},
): Promise<boolean> {
  if (!data) return false;

  if (data.checkout_url) {
    window.location.href = data.checkout_url;
    return true;
  }

  if (data.razorpay_subscription_id && data.razorpay_key_id) {
    await loadRazorpayCheckoutScript();
    if (!window.Razorpay) return false;

    const razorpay = new window.Razorpay({
      key: data.razorpay_key_id,
      subscription_id: data.razorpay_subscription_id,
      name: options.productName ?? "Vantly UGC",
      prefill: options.prefill,
      handler: (response: { razorpay_payment_id: string }) => {
        options.onRazorpaySuccess?.(response);
        const dest = options.successPath === undefined ? DEFAULT_SUCCESS_PATH : options.successPath;
        if (dest) window.location.href = dest;
      },
      modal: {
        ondismiss: () => {
          options.onRazorpayDismiss?.();
          const dest = options.cancelPath === undefined ? DEFAULT_CANCEL_PATH : options.cancelPath;
          if (dest) window.location.href = dest;
        },
      },
    });
    razorpay.open();
    return true;
  }

  if (data.razorpay_order_id && data.razorpay_key_id) {
    await loadRazorpayCheckoutScript();
    if (!window.Razorpay) return false;

    const razorpay = new window.Razorpay({
      key: data.razorpay_key_id,
      order_id: data.razorpay_order_id,
      amount: data.amount_paise,
      currency: "INR",
      name: options.productName ?? "Vantly UGC",
      prefill: options.prefill,
      handler: (response: { razorpay_payment_id: string }) => {
        options.onRazorpaySuccess?.(response);
        const dest = options.successPath === undefined ? DEFAULT_SUCCESS_PATH : options.successPath;
        if (dest) window.location.href = dest;
      },
      modal: {
        ondismiss: () => {
          options.onRazorpayDismiss?.();
          const dest = options.cancelPath === undefined ? DEFAULT_CANCEL_PATH : options.cancelPath;
          if (dest) window.location.href = dest;
        },
      },
    });
    razorpay.open();
    return true;
  }

  return false;
}
