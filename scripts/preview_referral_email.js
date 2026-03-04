require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Resend } = require('resend');

const Submission = require('../src/models/Submission');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not set in .env — preview script requires read-only DB access.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  let submission;
  if (args.submissionId) {
    if (!mongoose.Types.ObjectId.isValid(args.submissionId)) {
      console.error('Invalid submissionId provided.');
      process.exit(1);
    }
    submission = await Submission.findById(args.submissionId).lean();
  } else {
    // find the most recent submission that used a referral code
    submission = await Submission.findOne({ referredByCode: { $ne: null } }).sort({ createdAt: -1 }).lean();
  }

  if (!submission) {
    console.error('No submission found to preview. Provide --submissionId or ensure at least one submission has referredByCode.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const referrer = submission.referredByCode
    ? await Submission.findOne({ referralCode: submission.referredByCode }).lean()
    : null;

  if (!referrer) {
    console.error('Referrer not found for submission. Cannot build referral notification preview.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Use the same presentation as the live notification but do NOT write to DB
  const totalReferrals = referrer.referralUseCount || 0; // read-only

  const subject = `${submission.name} just used your referral code!`;

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; max-width:600px; margin:0 auto; padding:24px;">
      <div style="text-align:center; margin-bottom:28px;">
        <h1 style="font-size:22px; font-weight:800; color:#111; margin:0 0 4px;">Your referral code just worked!</h1>
        <p style="font-size:14px; color:#888; margin:0;">Someone joined MyPerro through you.</p>
      </div>

      <p style="font-size:16px; line-height:1.6; color:#333;">Hi ${referrer.name},</p>
      <p style="font-size:16px; line-height:1.6; color:#333;"><strong>${submission.name}</strong>${submission.dogsname ? ` (and ${submission.dogsname})` : ''} just signed up using your referral code. Your community is growing!</p>

      <div style="background:#f0fdf4; border:2px solid #22c55e; border-radius:10px; padding:20px 24px; margin:24px 0; text-align:center;">
        <p style="font-size:13px; color:#666; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px;">Total Successful Referrals</p>
        <p style="font-size:48px; font-weight:900; color:#16a34a; margin:0; line-height:1;">${totalReferrals}</p>
        <p style="font-size:13px; color:#666; margin:8px 0 0;">people have joined through your code so far</p>
      </div>

      <p style="font-size:15px; line-height:1.7; color:#444;">Keep sharing your code — the more people you bring in, the bigger the reward waiting for you.</p>

      <p style="font-size:15px; color:#444;">Got questions? Contact us at <a href="mailto:contact.us@myperro.in" style="color:#0ea5e9;">contact.us@myperro.in</a></p>

      <p style="font-size:15px; color:#333; margin-top:24px;">Thank you,<br><strong>MyPerro Team.</strong></p>

      <p style="font-size:12px; color:#aaa; border-top:1px solid #eee; padding-top:16px; margin-top:24px;">&copy; MyPerro — <a href="https://www.myperro.in" style="color:#aaa;">www.myperro.in</a></p>
    </div>
  `;

  const text = `Your referral code just worked!

Hi ${referrer.name},

${submission.name}${submission.dogsname ? ` (and ${submission.dogsname})` : ''} just signed up using your referral code. Your community is growing!

Total Successful Referrals: ${totalReferrals}

Keep sharing your code - the more people you bring in, the bigger the reward waiting for you.

Got questions? Contact us at contact.us@myperro.in

Thank you,
MyPerro Team.

www.myperro.in`;

  // output to console
  console.log('\n--- Referral Email Preview ---\n');
  console.log('Subject:', subject);
  console.log('\nPlain text:\n');
  console.log(text);

  // write html preview file
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `referral_preview_${submission._id}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('\nHTML preview written to:', outPath);

  // Optionally send the preview via Resend (read-only; no DB changes)
  if (args.sendTo) {
    const resendKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM;
    if (!resendKey || !mailFrom) {
      console.error('RESEND_API_KEY or MAIL_FROM not set in .env; cannot send email.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const resend = new Resend(resendKey);
    try {
      const to = String(args.sendTo).trim();
      console.log('\nSending preview email to', to);
      const res = await resend.emails.send({
        from: mailFrom,
        to,
        subject,
        html,
        text
      });
      console.log('Send result:', res?.id ? `OK — id=${res.id}` : JSON.stringify(res));
    } catch (err) {
      console.error('Failed to send preview email:', err);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Preview failed:', err);
  process.exit(1);
});
