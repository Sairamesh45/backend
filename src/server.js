require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;

const Submission = require('./models/Submission');
const EnrollmentCounter = require('./models/EnrollmentCounter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEBUG_PAYMENTS = process.env.DEBUG_PAYMENTS === 'true';

const COHORT_SIZE = 20;
const ENROLLMENT_COUNTER_KEY = 'cohort_enrollment';

const TIER_CONFIG = {
  starter: { amount: 500, amountPaise: 50000, label: 'Starter Pack' },
  founding: { amount: 2499, amountPaise: 249900, label: 'Founding Member' }
};
const VALID_TIERS = Object.keys(TIER_CONFIG);

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error('MONGO_URI is required in environment variables.');
}

mongoose
  .connect(mongoUri)
  .then(() => {
    console.log('Connected to MongoDB');
    if (DEBUG_PAYMENTS) {
      const dbName = mongoose.connection?.name;
      const host = mongoose.connection?.host;
      console.log(`[debug] mongoose connected: host=${host}, db=${dbName}`);
    }
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });

const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;
if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
  throw new Error('Cloudinary credentials are required in environment variables.');
}

cloudinary.config({
  cloud_name: cloudinaryCloudName,
  api_key: cloudinaryApiKey,
  api_secret: cloudinaryApiSecret
});

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const razorpayClient = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret
    })
  : null;

const resendApiKey = process.env.RESEND_API_KEY;
const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

function sendMailInBackground(mailOptions, contextLabel) {
  setImmediate(async () => {
    try {
      await resendClient.emails.send({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text
      });
    } catch (error) {
      console.error(`[mail] ${contextLabel} failed:`, error.message);
    }
  });
}

function uploadToCloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'dog-submissions',
        resource_type: 'image'
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    stream.end(fileBuffer);
  });
}

function debugRequestContext(routeName, details) {
  if (!DEBUG_PAYMENTS) {
    return;
  }

  const dbName = mongoose.connection?.name;
  const host = mongoose.connection?.host;
  const collectionName = Submission.collection?.name;
  console.log(`[debug] ${routeName} context`, {
    dbName,
    host,
    collectionName,
    ...details
  });
}

async function generateUniqueReferralCode(maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const code = `REF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const exists = await Submission.exists({ referralCode: code });
    if (!exists) {
      return code;
    }
  }

  throw new Error('Unable to generate a unique referral code.');
}

async function assignCohortAndReferral(submission) {
  if (submission.cohortNumber && (submission.cohortPosition || submission.cohortSlot) && submission.referralCode) {
    return;
  }

  const counterDoc = await EnrollmentCounter.findOneAndUpdate(
    { key: ENROLLMENT_COUNTER_KEY },
    { $inc: { totalPaid: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const position = counterDoc.totalPaid;
  const cohortNumber = Math.ceil(position / COHORT_SIZE);
  const cohortSlot = ((position - 1) % COHORT_SIZE) + 1;

  submission.cohortNumber = cohortNumber;
  submission.cohortSlot = cohortSlot;
  submission.cohortPosition = cohortSlot;

  // For captured payments we want a human-friendly referral code of the form "{dogname}-{cohortPosition}".
  // For non-captured states (e.g., authorized) keep the legacy random code to avoid collisions during tentative payments.
  if (String(submission.paymentStatus).toLowerCase() === 'captured') {
    const rawName = submission.dogsname || submission.name || 'DOG';
    const namePart = String(rawName)
      .replace(/[^A-Za-z0-9]/g, '')
      .substr(0, 40);
    let baseCode = `${namePart}-${cohortSlot}`.toUpperCase();

    // Ensure uniqueness by appending a numeric suffix if needed.
    let finalCode = baseCode;
    let suffix = 0;
    // eslint-disable-next-line no-await-in-loop
    while (await Submission.exists({ referralCode: finalCode })) {
      suffix += 1;
      finalCode = `${baseCode}-${suffix}`.toUpperCase();
    }

    submission.referralCode = finalCode;
  } else {
    submission.referralCode = await generateUniqueReferralCode();
  }

  submission.referralAssignedAt = new Date();
}

async function processReferralUsage(submission) {
  if (!submission.referredByCode) {
    return { referralCreditedNow: false, referrerTotalReferralCount: null };
  }

  const referrer = await Submission.findOne({ referralCode: submission.referredByCode });
  if (!referrer || String(referrer._id) === String(submission._id)) {
    return { referralCreditedNow: false, referrerTotalReferralCount: null };
  }

  const lockedSubmission = await Submission.findOneAndUpdate(
    { _id: submission._id, referralCredited: false },
    {
      $set: {
        referredBySubmissionId: referrer._id,
        referralCredited: true,
        referralCreditedAt: new Date()
      }
    },
    { new: true }
  );

  if (!lockedSubmission) {
    return { referralCreditedNow: false, referrerTotalReferralCount: null };
  }

  const updatedReferrer = await Submission.findByIdAndUpdate(
    referrer._id,
    { $inc: { referralUseCount: 1 } },
    { new: true }
  );

  if (resendClient) {
    const mailFrom = process.env.MAIL_FROM;
    const totalReferrals = updatedReferrer.referralUseCount;
    const subject = `${submission.name} just used your referral code!`;

    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; max-width:600px; margin:0 auto; padding:24px;">

        <!-- Header -->
        <div style="text-align:center; margin-bottom:28px;">
          <h1 style="font-size:22px; font-weight:800; color:#111; margin:0 0 4px;">Your referral code just worked!</h1>
          <p style="font-size:14px; color:#888; margin:0;">Someone joined MyPerro through you.</p>
        </div>

        <p style="font-size:16px; line-height:1.6; color:#333;">Hi ${referrer.name},</p>
        <p style="font-size:16px; line-height:1.6; color:#333;"><strong>${submission.name}</strong>${submission.dogsname ? ` (and ${submission.dogsname})` : ''} just signed up using your referral code. Your community is growing!</p>

        <!-- Stats -->
        <div style="background:#f0fdf4; border:2px solid #22c55e; border-radius:10px; padding:20px 24px; margin:24px 0; text-align:center;">
          <p style="font-size:13px; color:#666; margin:0 0 6px; text-transform:uppercase; letter-spacing:1px;">Total Successful Referrals</p>
          <p style="font-size:48px; font-weight:900; color:#16a34a; margin:0; line-height:1;">${totalReferrals}</p>
          <p style="font-size:13px; color:#666; margin:8px 0 0;">people have joined through your code so far</p>
        </div>

        <p style="font-size:15px; line-height:1.7; color:#444;">Keep sharing your code — the more people you bring in, the bigger the reward waiting for you.</p>

        <p style="font-size:15px; color:#444;">Got questions? Contact us at <a href="mailto:contact.us@myperro.in" style="color:#0ea5e9;">contact.us@myperro.in</a></p>

        <p style="font-size:15px; color:#333; margin-top:24px;">Thank you,<br><strong>MyPerro Team.</strong></p>

        <p style="font-size:12px; color:#aaa; border-top:1px solid #eee; padding-top:16px; margin-top:24px;">&copy; MyPerro &mdash; <a href="https://www.myperro.in" style="color:#aaa;">www.myperro.in</a></p>
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

    sendMailInBackground({
      from: mailFrom,
      to: referrer.mail,
      subject,
      html,
      text
    }, 'referral-used');
  }

  return {
    referralCreditedNow: true,
    referrerTotalReferralCount: updatedReferrer.referralUseCount
  };
}

// Security headers — makes the server look legitimate to firewalls & autoblockers
// CORS is handled entirely by nginx to avoid duplicate headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/debug/submission/:id', async (req, res, next) => {
  try {
    if (!DEBUG_PAYMENTS) {
      return res.status(404).json({ message: 'Not found.' });
    }

    const { id } = req.params;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);
    const found = isValidObjectId
      ? await Submission.findById(id).select('_id paymentStatus paymentId createdAt').lean()
      : null;

    return res.status(200).json({
      data: {
        id,
        isValidObjectId,
        found: Boolean(found),
        submission: found || null,
        connection: {
          host: mongoose.connection?.host || null,
          dbName: mongoose.connection?.name || null,
          collectionName: Submission.collection?.name || null
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/referral/validate', async (req, res, next) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({
        message: 'Referral code is required.'
      });
    }

    const referrer = await Submission.findOne({ referralCode: code })
      .select('_id name referralCode referralUseCount')
      .lean();

    if (!referrer) {
      return res.status(404).json({
        message: 'Invalid referral code.',
        valid: false
      });
    }

    return res.status(200).json({
      message: 'Referral code is valid.',
      valid: true,
      data: {
        referrerName: referrer.name,
        referralCode: referrer.referralCode,
        referralUseCount: referrer.referralUseCount
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/spots/status', async (_req, res, next) => {
  try {
    const counter = await EnrollmentCounter.findOne({ key: ENROLLMENT_COUNTER_KEY }).lean();
    const totalPaid = counter?.totalPaid || 0;

    let currentCohortNumber = totalPaid > 0
      ? Math.floor((totalPaid - 1) / COHORT_SIZE) + 1
      : 1;
    let claimedInCurrentCohort = totalPaid > 0
      ? ((totalPaid - 1) % COHORT_SIZE) + 1
      : 0;

    if (claimedInCurrentCohort === COHORT_SIZE) {
      currentCohortNumber += 1;
      claimedInCurrentCohort = 0;
    }

    const remainingInCurrentCohort = COHORT_SIZE - claimedInCurrentCohort;

    const lastPaid = await Submission.findOne({
      paymentStatus: { $in: ['authorized', 'captured'] },
      paidAt: { $ne: null }
    })
      .select('paidAt')
      .sort({ paidAt: -1 })
      .lean();

    return res.status(200).json({
      message: 'Spots status fetched successfully.',
      data: {
        currentCohortNumber,
        claimed: claimedInCurrentCohort,
        total: COHORT_SIZE,
        remaining: remainingInCurrentCohort,
        totalPaidOverall: totalPaid,
        lastClaimedAt: lastPaid?.paidAt || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/activity/live', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const activity = await Submission.find({
      paymentStatus: { $in: ['authorized', 'captured'] },
      paidAt: { $ne: null },
      cohortNumber: { $ne: null }
    })
      .select('dogsname name city cohortNumber cohortPosition cohortSlot tier amount paidAt')
      .sort({ paidAt: -1 })
      .limit(limit)
      .lean();

    const data = activity.map((item) => ({
      dogName: item.dogsname,
      parentName: item.name,
      city: item.city,
      cohortNumber: item.cohortNumber,
      position: item.cohortPosition || item.cohortSlot,
      tier: item.tier || 'starter',
      amount: item.amount || 500,
      claimedAt: item.paidAt
    }));

    return res.status(200).json({
      message: 'Live activity fetched successfully.',
      data
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/cohorts', async (_req, res, next) => {
  try {
    const submissions = await Submission.find({
      cohortNumber: { $ne: null },
      paymentStatus: { $in: ['authorized', 'captured'] }
    })
      .select('cohortNumber cohortPosition cohortSlot dogsname dogphoto.url')
      .sort({ cohortNumber: 1, cohortPosition: 1, cohortSlot: 1 })
      .lean();

    const grouped = submissions.reduce((acc, item) => {
      const key = `cohort ${item.cohortNumber}`;
      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push({
        dogName: item.dogsname,
        dogPhoto: item.dogphoto.url,
        position: item.cohortPosition || item.cohortSlot
      });

      return acc;
    }, {});

    return res.status(200).json({
      message: 'Cohorts fetched successfully.',
      data: grouped
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/submit', upload.single('dogphoto'), async (req, res, next) => {
  try {
    const { name, phoneno, address, city, state, mail, dogsname, referralCode, tier: rawTier } = req.body;
    const tier = VALID_TIERS.includes(rawTier) ? rawTier : 'starter';
    const tierConfig = TIER_CONFIG[tier];
    debugRequestContext('/submit', { mail, dogsname, tier });

    if (!name || !phoneno || !address || !city || !state || !mail || !dogsname) {
      return res.status(400).json({
        message: 'All fields are required: name, phoneno, address, city, state, mail, dogsname.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: 'Dog photo is required under field name dogphoto.'
      });
    }

    const normalizedReferralCode = referralCode ? String(referralCode).trim().toUpperCase() : null;
    if (normalizedReferralCode) {
      const referrerExists = await Submission.exists({ referralCode: normalizedReferralCode });
      if (!referrerExists) {
        return res.status(400).json({
          message: 'Invalid referral code.'
        });
      }
    }

    const uploadResult = await uploadToCloudinary(req.file.buffer);
    let submission;
    try {
      submission = await Submission.create({
        name,
        phoneno,
        address,
        city,
        state,
        mail,
        dogsname,
        tier,
        amount: tierConfig.amount,
        referredByCode: normalizedReferralCode,
        dogphoto: {
          publicId: uploadResult.public_id,
          url: uploadResult.secure_url,
          mimetype: req.file.mimetype,
          size: req.file.size
        }
      });
    } catch (dbError) {
      // DB insert failed after image upload: clean up uploaded asset.
      await cloudinary.uploader.destroy(uploadResult.public_id, { resource_type: 'image' });
      throw dbError;
    }

    return res.status(201).json({
      message: 'Submission received successfully.',
      data: submission
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/payment/success', async (req, res, next) => {
  try {
    if (!razorpayClient) {
      return res.status(500).json({
        message: 'Razorpay is not configured on the backend.'
      });
    }

    const { submissionId, razorpay_payment_id, razorpay_order_id } = req.body;
    const normalizedSubmissionId = String(submissionId || '').trim();
    debugRequestContext('/payment/success', {
      submissionId: normalizedSubmissionId,
      razorpay_payment_id,
      razorpay_order_id
    });

    if (!normalizedSubmissionId || !razorpay_payment_id) {
      return res.status(400).json({
        message: 'submissionId and razorpay_payment_id are required.'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(normalizedSubmissionId)) {
      return res.status(400).json({
        message: 'Invalid submissionId format.'
      });
    }

    const submission = await Submission.findById(normalizedSubmissionId);
    debugRequestContext('/payment/success lookup', { found: Boolean(submission) });
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (submission.paymentId && submission.paymentId !== razorpay_payment_id) {
      return res.status(409).json({
        message: 'This submission is already linked to a different payment.'
      });
    }

    const paymentAlreadyUsed = await Submission.findOne({
      _id: { $ne: submission._id },
      paymentId: razorpay_payment_id
    }).select('_id').lean();
    if (paymentAlreadyUsed) {
      return res.status(409).json({
        message: 'This payment id is already used for another submission.'
      });
    }

    const payment = await razorpayClient.payments.fetch(razorpay_payment_id);
    if (!payment || !['authorized', 'captured'].includes(payment.status)) {
      submission.paymentStatus = 'failed';
      submission.paymentId = razorpay_payment_id;
      submission.paymentOrderId = razorpay_order_id || null;
      await submission.save();

      return res.status(400).json({
        message: 'Payment not successful according to Razorpay.'
      });
    }

    const expectedTier = TIER_CONFIG[submission.tier] || TIER_CONFIG.starter;
    if (payment.amount && Number(payment.amount) !== expectedTier.amountPaise) {
      return res.status(400).json({
        message: `Payment amount mismatch. Expected ₹${expectedTier.amount} (${expectedTier.amountPaise} paise) but received ${payment.amount} paise.`
      });
    }

    if (razorpay_order_id && payment.order_id && razorpay_order_id !== payment.order_id) {
      return res.status(400).json({
        message: 'Order id mismatch for this payment.'
      });
    }

    submission.paymentStatus = payment.status;
    submission.paymentId = razorpay_payment_id;
    submission.paymentOrderId = payment.order_id || razorpay_order_id || null;
    if (!submission.paidAt) {
      submission.paidAt = payment.created_at ? new Date(payment.created_at * 1000) : new Date();
    }

    await assignCohortAndReferral(submission);
    await submission.save();
    const referralResult = await processReferralUsage(submission);

    let emailSent = false;
    if (!submission.confirmationSentAt) {
      if (!resendClient) {
        return res.status(500).json({
          message: 'Resend email is not configured on the backend.'
        });
      }

      const mailFrom = process.env.MAIL_FROM;
      const tierKey = submission.tier || 'starter';
      const isFoundingMember = tierKey === 'founding';
      const position = submission.cohortPosition || submission.cohortSlot || '';
      const orderId = submission.paymentOrderId || razorpay_order_id || '';
      const referralCodeFormatted = submission.referralCode || `${submission.dogsname || ''}-${position}`;

      const subject = `${submission.dogsname} is officially on the map - your order is confirmed!`;

      const foundingBadge = isFoundingMember
        ? `<div style="background:#f5f3ff; border:2px solid #7c3aed; border-radius:10px; padding:14px 18px; margin:20px 0; text-align:center;">
            <span style="background:#7c3aed; color:#fff; font-size:12px; font-weight:700; letter-spacing:1px; padding:4px 14px; border-radius:20px; text-transform:uppercase;">Founding Member</span>
            <p style="margin:10px 0 0; font-size:14px; color:#555;">You're among the first to bring MyPerro home. Thank you for believing in us from day one.</p>
          </div>`
        : '';

      const html = `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; max-width:600px; margin:0 auto; padding:24px;">

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
              <td style="padding:11px 14px; border:1px solid #e8e8e8; font-size:13px; color:#555;">${razorpay_payment_id}</td>
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

      const text = `${submission.dogsname} is officially on the map - your order is confirmed!

Hi ${submission.name}, ${submission.dogsname} just made it official${isFoundingMember ? ' — as a Founding Member' : ''}.

Your payment went through, and your MyPerro GPS collar is now reserved — built to make sure ${submission.dogsname} is always findable, always safe, always yours.${isFoundingMember ? ` As a Founding Member, ${submission.dogsname} gets priority in every batch.` : ''}

ORDER DETAILS

Dog's Name        | ${submission.dogsname}
Payment ID        | ${razorpay_payment_id}
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

      sendMailInBackground({
        from: mailFrom,
        to: submission.mail,
        subject,
        text,
        html
      }, 'payment-confirmation');

      setImmediate(async () => {
        try {
          await Submission.findByIdAndUpdate(submission._id, {
            $set: { confirmationSentAt: new Date() }
          });
        } catch (error) {
          console.error('[mail] failed to persist confirmationSentAt:', error.message);
        }
      });

      emailSent = true;
    }

    return res.status(200).json({
      message: 'Payment verified successfully.',
      paymentStatus: submission.paymentStatus,
      emailSent,
      referralCreditedNow: referralResult.referralCreditedNow,
      referrerTotalReferralCount: referralResult.referrerTotalReferralCount,
      data: submission
    });
  } catch (error) {
    return next(error);
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  if (err) {
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({ message: err.message || 'Request failed.' });
  }
  return res.status(500).json({ message: 'Internal server error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
