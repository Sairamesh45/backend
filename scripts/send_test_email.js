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
  const isFoundingMember = tierKey === 'founding';

  const position              = submission.cohortPosition || submission.cohortSlot || '';
  const referralCodeFormatted = submission.referralCode || `${submission.dogsname || ''}-${position}`;

  const subject = `[TEST – ${tierLabel}] ${submission.dogsname} is officially on the map - your order is confirmed!`;

  const foundingBadge = isFoundingMember
    ? `<div style="background:#f5f3ff; border:2px solid #7c3aed; border-radius:10px; padding:14px 18px; margin:20px 0; text-align:center;">
        <span style="background:#7c3aed; color:#fff; font-size:12px; font-weight:700; letter-spacing:1px; padding:4px 14px; border-radius:20px; text-transform:uppercase;">Founding Member</span>
        <p style="margin:10px 0 0; font-size:14px; color:#555;">You're among the first to bring MyPerro home. Thank you for believing in us from day one.</p>
      </div>`
    : '';

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; max-width:600px; margin:0 auto; padding:24px;">
      <p style="background:#fffbcc; border:1px solid #e6db74; padding:6px 12px; border-radius:4px; font-size:12px; color:#555;">⚠️ This is a TEST email — no real order was placed.</p>

      <!-- Header -->
      <div style="text-align:center; margin-bottom:28px;">
        <h1 style="font-size:22px; font-weight:800; color:#111; margin:0 0 4px;">${submission.dogsname} is officially on the map.</h1>
        <p style="font-size:14px; color:#888; margin:0;">Your order is confirmed!</p>
      </div>

      <!-- Intro -->
      <p style="font-size:16px; line-height:1.6; color:#333;">Hi ${submission.name}, <strong>${submission.dogsname}</strong> just made it official${isFoundingMember ? ' as a Founding Member' : ''}.</p>
      <p style="font-size:16px; line-height:1.6; color:#333;">Your payment went through, and your MyPerro GPS collar is now reserved, built to make sure <strong>${submission.dogsname}</strong> is always findable, always safe, always yours.${isFoundingMember ? ` As a Founding Member, <strong>${submission.dogsname}</strong> gets priority in every batch.` : ''}</p>

      ${foundingBadge}

      <!-- ORDER DETAILS -->
      <h3 style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#999; border-top:1px solid #eee; padding-top:22px; margin-top:28px;">Order Details</h3>
      <table style="border-collapse:collapse; width:100%; font-size:15px;">
        <tr>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; color:#666; width:45%;">Dog's Name</td>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; font-weight:600;">${submission.dogsname}</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:11px 14px; border:1px solid #e8e8e8; color:#666;">Payment ID</td>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; font-size:13px; color:#555;">${paymentId}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; color:#666;">Order ID</td>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; font-size:13px; color:#555;">${orderId}</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:11px 14px; border:1px solid #e8e8e8; color:#666;">Cohort</td>
          <td style="padding:11px 14px; border:1px solid #e8e8e8;">${submission.cohortNumber || ''}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px; border:1px solid #e8e8e8; color:#666;">Position in Cohort</td>
          <td style="padding:11px 14px; border:1px solid #e8e8e8;">${position}${position ? '/' + COHORT_SIZE : ''}</td>
        </tr>
      </table>

      <!-- REFERRAL CODE -->
      <h3 style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#999; border-top:1px solid #eee; padding-top:22px; margin-top:28px;">Your Referral Code</h3>
      <div style="text-align:center; margin:16px 0;">
        <span style="font-size:22px; font-weight:800; letter-spacing:2px; background:#f6f6f6; padding:12px 24px; border-radius:8px; display:inline-block; color:#111;">${referralCodeFormatted}</span>
      </div>
      <p style="font-size:15px; color:#444; text-align:center;">Know another dog parent who'd love this? Share your code &mdash; the more you share, the bigger the gift waiting for you!</p>

      <!-- WHAT HAPPENS NOW -->
      <h3 style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#999; border-top:1px solid #eee; padding-top:22px; margin-top:28px;">What Happens Now?</h3>
      <p style="font-size:15px; line-height:1.7; color:#444;">We'll add you to a WhatsApp group for <strong>${submission.dogsname}</strong>. All future updates, including shipping notices and batch announcements, will be posted there so you can follow progress in one place.</p>

      <p style="font-size:15px; color:#444;">Got questions? Contact us at <a href="mailto:contact.us@myperro.in" style="color:#0ea5e9;">contact.us@myperro.in</a></p>

      <p style="font-size:15px; color:#333; margin-top:24px;">Thank you,<br><strong>MyPerro Team.</strong></p>

      <p style="font-size:12px; color:#aaa; border-top:1px solid #eee; padding-top:16px; margin-top:24px;">&copy; MyPerro &mdash; <a href="https://www.myperro.in" style="color:#aaa;">www.myperro.in</a></p>
    </div>
  `;

  const text = `[TEST – ${tierLabel}] ${submission.dogsname} is officially on the map - your order is confirmed!

Hi ${submission.name}, ${submission.dogsname} just made it official${isFoundingMember ? ' — as a Founding Member' : ''}.

Your payment went through, and your MyPerro GPS collar is now reserved — built to make sure ${submission.dogsname} is always findable, always safe, always yours.${isFoundingMember ? ` As a Founding Member, ${submission.dogsname} gets priority in every batch.` : ''}

ORDER DETAILS

Dog's Name        | ${submission.dogsname}
Payment ID        | ${paymentId}
Order ID          | ${orderId}
Cohort            | ${submission.cohortNumber || ''}
Position in Cohort| ${position}${position ? '/' + COHORT_SIZE : ''}

YOUR REFERRAL CODE

${referralCodeFormatted}

Know another dog parent who'd love this? Share your code — the more you share, the bigger the gift waiting for you!

WHAT HAPPENS NOW?

We'll add you to a WhatsApp group for ${submission.dogsname}. All future updates, including shipping notices and batch announcements, will be posted there so you can follow progress in one place.

Got questions? Contact us at contact.us@myperro.in

Thank you,
MyPerro Team.

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
