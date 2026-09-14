// api/stripe-health.js — Dev-only Stripe config diagnostic
// GET ?dev=<DEV_BYPASS_KEY> → returns mode, env var presence, price resolution
// Lets you verify live vs test without reading raw env vars.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.DEV_BYPASS_KEY;
  const provided = req.query?.dev || req.headers['x-dev-key'];
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = process.env.STRIPE_SECRET_KEY || '';
  const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown';

  const report = {
    mode,
    env: {
      STRIPE_SECRET_KEY:           key ? `${key.slice(0, 10)}…` : 'MISSING',
      STRIPE_WEBHOOK_SECRET:       process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'MISSING',
      STRIPE_PRO_PRICE_ID:         process.env.STRIPE_PRO_PRICE_ID || 'MISSING',
      STRIPE_ELITE_PRICE_ID:       process.env.STRIPE_ELITE_PRICE_ID || 'MISSING',
      STRIPE_PRO_PRICE_ID_TEST:    process.env.STRIPE_PRO_PRICE_ID_TEST || 'MISSING',
      STRIPE_ELITE_PRICE_ID_TEST:  process.env.STRIPE_ELITE_PRICE_ID_TEST || 'MISSING',
      SUPABASE_URL:                process.env.SUPABASE_URL ? 'SET' : 'MISSING',
    },
    prices: {},
  };

  if (key) {
    const stripe = require('stripe')(key);
    for (const [label, priceId] of [
      ['pro', process.env.STRIPE_PRO_PRICE_ID],
      ['elite', process.env.STRIPE_ELITE_PRICE_ID],
    ]) {
      if (!priceId) { report.prices[label] = 'NO_PRICE_ID'; continue; }
      try {
        const p = await stripe.prices.retrieve(priceId);
        report.prices[label] = {
          id: p.id,
          active: p.active,
          currency: p.currency,
          amount: (p.unit_amount / 100).toFixed(2),
          recurring: p.recurring?.interval,
        };
      } catch (err) {
        report.prices[label] = `ERROR: ${err.message}`;
      }
    }
  }

  return res.json(report);
};
