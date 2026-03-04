const { Resend } = require('resend');
require('dotenv').config();

const COHORT_SIZE = 20;

const TIER_CONFIG = {
  starter:  { amount: 500,  amountPaise: 50000,  label: 'Starter Pack' },
  founding: { amount: 2499, amountPaise: 249900, label: 'Founding Member' }
};

function buildEmail({ tier, submission, paymentId, orderId }) {
  const tierKey = tier;
  const tierConfig = TIER_CONFIG[tierKey];
  const tierLabel   = tierConfig.label;
  const tierAmount  = tierConfig.amount;
  const isFoundingMember = tierKey === 'founding';

  const position             = submission.cohortPosition || submission.cohortSlot || '';
  const referralCodeFormatted = `${submission.dogsname || ''}-${position}`;

  const tierBadgeColor = isFoundingMember ? '#7c3aed' : '#0ea5e9';
  const tierBadgeBg    = isFoundingMember ? '#f5f3ff' : '#f0f9ff';
  const tierPerks = isFoundingMember
    ? `<ul style="margin:8px 0; padding-left:20px; color:#444;">
        <li>Founding Member badge &amp; lifetime recognition</li>
        <li>Priority access to all future features</li>
        <li>Exclusive Founding Member community</li>
        <li>MyPerro GPS collar + premium accessories</li>
      </ul>`
    : `<ul style="margin:8px 0; padding-left:20px; color:#444;">
        <li>MyPerro GPS collar</li>
        <li>Access to the MyPerro app</li>
        <li>Real-time tracking for ${submission.dogsname}</li>
      </ul>`;

  const subject = `[TEST – ${tierLabel}] 🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222; max-width:600px; margin:0 auto;">
      <p style="background:#fffbcc; border:1px solid #e6db74; padding:6px 12px; border-radius:4px; font-size:12px; color:#555;">⚠️ This is a TEST email — no real order was placed.</p>
      <h2>🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!</h2>
      <p>Hi ${submission.name},</p>
      <p>Great news — your payment was successful! We're thrilled to welcome <strong>${submission.dogsname}</strong> to the MyPerro community.</p>

      <!-- Tier & Amount Banner -->
      <div style="background:${tierBadgeBg}; border:2px solid ${tierBadgeColor}; border-radius:10px; padding:16px 20px; margin:20px 0;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <span style="background:${tierBadgeColor}; color:#fff; font-size:13px; font-weight:700; letter-spacing:1px; padding:4px 12px; border-radius:20px; text-transform:uppercase;">${tierLabel}</span>
          <span style="font-size:28px; font-weight:800; color:${tierBadgeColor};">₹${tierAmount}</span>
        </div>
        <div style="margin-top:10px; font-size:14px; color:#555;">What's included in your <strong>${tierLabel}</strong>:</div>
        ${tierPerks}
      </div>

      <h3>Here's a summary of your order:</h3>
      <table style="border-collapse: collapse; width: 100%;">
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Plan / Tier</td>
          <td style="padding:8px 12px; border:1px solid #eee;">
            <span style="background:${tierBadgeColor}; color:#fff; font-size:12px; font-weight:700; padding:2px 10px; border-radius:12px;">${tierLabel}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Amount Paid</td>
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:700; color:${tierBadgeColor};">₹${tierAmount}</td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Dog's Name</td>
          <td style="padding:8px 12px; border:1px solid #eee;">${submission.dogsname}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Payment ID</td>
          <td style="padding:8px 12px; border:1px solid #eee; font-size:13px; color:#555;">${paymentId}</td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Order ID</td>
          <td style="padding:8px 12px; border:1px solid #eee; font-size:13px; color:#555;">${orderId}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Cohort</td>
          <td style="padding:8px 12px; border:1px solid #eee;">${submission.cohortNumber || ''}</td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px; border:1px solid #eee; font-weight:600;">Position in Cohort</td>
          <td style="padding:8px 12px; border:1px solid #eee;">${position}${position ? '/' + COHORT_SIZE : ''}</td>
        </tr>
      </table>

      <h3>🎁 Your Referral Code</h3>
      <p>Share MyPerro with fellow dog lovers and earn rewards!</p>
      <p style="font-size:18px; background:#f6f6f6; display:inline-block; padding:8px 12px; border-radius:4px;">${referralCodeFormatted}</p>

      <h3>What's Next?</h3>
      <p>Your MyPerro GPS collar is being prepared. You'll receive a shipping confirmation email with tracking details as soon as your order is on its way.</p>
      <p>In the meantime, feel free to explore our app to set up your account and get ready for ${submission.dogsname}'s first adventure.</p>

      <p>If you have any questions, don't hesitate to reach out to us at <a href="mailto:support@myperro.com">support@myperro.com</a>.</p>

      <p>Thank you for trusting MyPerro to keep ${submission.dogsname} safe. 🐶</p>

      <p>The MyPerro Team</p>

      <p style="font-size:12px; color:#888;">© MyPerro — <a href="https://www.myperro.in">www.myperro.in</a></p>
    </div>
  `;

  const text = `[TEST – ${tierLabel}] 🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!

Hi ${submission.name},

Great news — your payment was successful! We're thrilled to welcome ${submission.dogsname} to the MyPerro community.

━━━━━━━━━━━━━━━━━━━━━━━━
Plan / Tier : ${tierLabel}
Amount Paid : ₹${tierAmount}
━━━━━━━━━━━━━━━━━━━━━━━━

Order summary:
Dog's Name        : ${submission.dogsname}
Payment ID        : ${paymentId}
Order ID          : ${orderId}
Cohort            : ${submission.cohortNumber || ''}
Position in Cohort: ${position}${position ? '/' + COHORT_SIZE : ''}

Your Referral Code: ${referralCodeFormatted}

What's Next?
Your MyPerro GPS collar is being prepared. You'll receive a shipping confirmation email with tracking details as soon as your order is on its way.

If you have any questions, reach out to support@myperro.com.

Thank you for trusting MyPerro to keep ${submission.dogsname} safe.

The MyPerro Team
www.myperro.in`;

  return { subject, html, text };
}

async function main() {
  const mailTo = 'sairamesh4551621@gmail.com';

  const submission = {
    name: 'Sai Ramesh',
    dogsname: 'Rufus',
    cohortNumber: 2,
    cohortSlot: 5,
    cohortPosition: 5,
    mail: mailTo
  };

  const paymentId = 'pay_TEST123456';
  const orderId   = 'order_TEST7890';

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('RESEND_API_KEY is not set in .env');
    process.exit(1);
  }

  const resend   = new Resend(resendApiKey);
  const mailFrom = process.env.MAIL_FROM;

  for (const tier of ['starter', 'founding']) {
    const { subject, html, text } = buildEmail({ tier, submission, paymentId, orderId });

    console.log(`\nSending ${tier} tier email…`);
    const { data, error } = await resend.emails.send({
      from: mailFrom,
      to: mailTo,
      subject,
      html,
      text
    });

    if (error) {
      console.error(`  ✗ Failed (${tier}):`, error);
    } else {
      console.log(`  ✓ Sent (${tier}) — ID: ${data.id}`);
    }
  }
}

main().catch((err) => {
  console.error('Failed to send test email:', err);
  process.exit(1);
});
