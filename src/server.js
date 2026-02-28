require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;

const Submission = require('./models/Submission');
const EnrollmentCounter = require('./models/EnrollmentCounter');

const app = express();
const PORT = process.env.PORT || 3000;
const DEBUG_PAYMENTS = process.env.DEBUG_PAYMENTS === 'true';

const COHORT_SIZE = 20;
const ENROLLMENT_COUNTER_KEY = 'cohort_enrollment';

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
  const referralCode = await generateUniqueReferralCode();

  submission.cohortNumber = cohortNumber;
  submission.cohortSlot = cohortSlot;
  submission.cohortPosition = cohortSlot;
  submission.referralCode = referralCode;
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
    const subject = 'Congrats! Your referral code was used';
    const html = `
      <h2>Referral Update</h2>
      <p>Hi ${referrer.name},</p>
      <p>Congrats, your referral code was used successfully.</p>
      <p><strong>Total successful referrals:</strong> ${updatedReferrer.referralUseCount}</p>
    `;

    sendMailInBackground({
      from: mailFrom,
      to: referrer.mail,
      subject,
      html
    }, 'referral-used');
  }

  return {
    referralCreditedNow: true,
    referrerTotalReferralCount: updatedReferrer.referralUseCount
  };
}

app.use(cors());
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
      .select('dogsname name city cohortNumber cohortPosition cohortSlot paidAt')
      .sort({ paidAt: -1 })
      .limit(limit)
      .lean();

    const data = activity.map((item) => ({
      dogName: item.dogsname,
      parentName: item.name,
      city: item.city,
      cohortNumber: item.cohortNumber,
      position: item.cohortPosition || item.cohortSlot,
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
    const { name, phoneno, address, city, mail, dogsname, referralCode } = req.body;
    debugRequestContext('/submit', { mail, dogsname });

    if (!name || !phoneno || !address || !city || !mail || !dogsname) {
      return res.status(400).json({
        message: 'All fields are required: name, phoneno, address, city, mail, dogsname.'
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
        mail,
        dogsname,
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
      const subject = `🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!`;

      const position = submission.cohortPosition || submission.cohortSlot || '';
      const orderId = submission.paymentOrderId || razorpay_order_id || '';
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
              <td style="padding:8px; border:1px solid #eee;">${razorpay_payment_id}</td>
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
              <td style="padding:8px; border:1px solid #eee;">${position}${position ? '/' + COHORT_SIZE : ''}</td>
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

      const text = `🐾 Payment Confirmed – Welcome to the MyPerro Family, ${submission.dogsname}!

Hi ${submission.name},

Great news — your payment was successful! We're thrilled to welcome ${submission.dogsname} to the MyPerro community.

Order summary:
Dog's Name: ${submission.dogsname}
Payment ID: ${razorpay_payment_id}
Order ID: ${orderId}
Cohort: ${submission.cohortNumber || ''}
Position in Cohort: ${position}${position ? '/' + COHORT_SIZE : ''}

Your Referral Code: ${referralCodeFormatted}

What's Next?
Your MyPerro GPS collar is being prepared. You'll receive a shipping confirmation email with tracking details as soon as your order is on its way.

If you have any questions, reach out to support@myperro.com.

Thank you for trusting MyPerro to keep ${submission.dogsname} safe.

The MyPerro Team
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
