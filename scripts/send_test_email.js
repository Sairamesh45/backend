const { Resend } = require('resend');
require('dotenv').config();

async function main() {
  const mailTo = 'sairamesh4551621@gmail.com';
  // Sample submission-like data to mirror server.js email format
  const submission = {
    name: 'Alex Tester',
    dogsname: 'Rufus',
    cohortNumber: 2,
    cohortSlot: 5,
    cohortPosition: 5,
    referralCode: 'REF1A2B3C',
    mail: mailTo
  };

  const paymentId = 'pay_TEST123456';
  const orderId = 'order_TEST7890';
  const position = submission.cohortPosition || submission.cohortSlot || '';
  const referralCodeFormatted = `${submission.dogsname || ''}-${position}`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222;">
      <h2>🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!</h2>
      <p>Hi ${submission.name},</p>
      <p>Great news — your payment was successful! We're thrilled to welcome <strong>${submission.dogsname}</strong> to the MyPerro community.</p>

      <h3>Here's a summary of your order:</h3>
      <table style="border-collapse: collapse; width: 100%; max-width:600px;">
        <tr>
          <td style="padding:8px; border:1px solid #eee;"><strong>Dog's Name</strong></td>
          <td style="padding:8px; border:1px solid #eee;">${submission.dogsname}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;"><strong>Payment ID</strong></td>
          <td style="padding:8px; border:1px solid #eee;">${paymentId}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;"><strong>Order ID</strong></td>
          <td style="padding:8px; border:1px solid #eee;">${orderId}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;"><strong>Cohort</strong></td>
          <td style="padding:8px; border:1px solid #eee;">${submission.cohortNumber || ''}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;"><strong>Position in Cohort</strong></td>
          <td style="padding:8px; border:1px solid #eee;">${position}${position ? '/20' : ''}</td>
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

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('RESEND_API_KEY is not set in .env');
    process.exit(1);
  }

  const resend = new Resend(resendApiKey);
  const mailFrom = process.env.MAIL_FROM;

  const { data, error } = await resend.emails.send({
    from: mailFrom,
    to: mailTo,
    subject: 'Payment Confirmation - Dog Registration (TEST)',
    html
  });

  if (error) {
    console.error('Failed to send:', error);
    process.exit(1);
  }

  console.log('Message sent! ID:', data.id);
}

main().catch((err) => {
  console.error('Failed to send test email:', err);
  process.exit(1);
});
