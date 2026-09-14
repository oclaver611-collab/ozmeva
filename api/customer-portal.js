// api/customer-portal.js — Creates a Stripe Billing Portal session for self-service cancel
// POST { customerId } → { url }
// The portal URL redirects back to / after the user finishes.
// Requires STRIPE_SECRET_KEY. Stripe Customer Portal must be configured in the dashboard
// before this returns a valid URL (see PENDING-APPROVALS PA-101).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'Stripe not configured' });

  const { customerId } = req.body || {};
  if (!customerId || !String(customerId).startsWith('cus_')) {
    return res.status(400).json({ error: 'Valid Stripe customer ID required' });
  }

  const origin = (req.headers.origin || req.headers.referer || 'https://ozmeva.com').replace(/\/$/, '');

  const stripe = require('stripe')(key);
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error('[customer-portal] Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
