require('dotenv').config();
const mongoose = require('mongoose');
const Submission = require('../src/models/Submission');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  const cursor = Submission.find({ paymentStatus: 'captured' }).cursor();
  let updated = 0;
  let skipped = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const position = doc.cohortPosition || doc.cohortSlot || null;
    if (!position) {
      console.warn(`Skipping ${doc._id} — no cohortPosition/cohortSlot`);
      skipped += 1;
      continue;
    }

    const rawName = doc.dogsname || doc.name || 'DOG';
    const namePart = String(rawName).replace(/[^A-Za-z0-9]/g, '').substr(0, 40);
    const base = `${namePart}-${position}`.toUpperCase();

    let candidate = base;
    let suffix = 0;
    // Ensure uniqueness across other documents
    // eslint-disable-next-line no-await-in-loop
    while (await Submission.exists({ referralCode: candidate, _id: { $ne: doc._id } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`.toUpperCase();
    }

    if (doc.referralCode === candidate) {
      // already in desired format
      continue;
    }

    try {
      await Submission.findByIdAndUpdate(doc._id, {
        $set: { referralCode: candidate, referralAssignedAt: new Date() }
      });
      console.log(`Updated ${doc._id} -> ${candidate}`);
      updated += 1;
    } catch (err) {
      console.error(`Failed to update ${doc._id}:`, err.message);
    }
  }

  console.log(`Migration complete. Updated: ${updated}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
