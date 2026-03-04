const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    phoneno: {
      type: String,
      required: true,
      trim: true
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    mail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    dogsname: {
      type: String,
      required: true,
      trim: true
    },
    dogphoto: {
      publicId: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      mimetype: {
        type: String,
        required: true
      },
      size: {
        type: Number,
        required: true
      }
    },
    cohortNumber: {
      type: Number,
      default: null,
      min: 1
    },
    cohortSlot: {
      type: Number,
      default: null,
      min: 1,
      max: 20
    },
    cohortPosition: {
      type: Number,
      default: null,
      min: 1,
      max: 20
    },
    referralCode: {
      type: String,
      default: undefined,
      uppercase: true,
      trim: true
    },
    referralUseCount: {
      type: Number,
      default: 0,
      min: 0
    },
    referredByCode: {
      type: String,
      default: null,
      uppercase: true,
      trim: true
    },
    referredBySubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      default: null
    },
    referralCredited: {
      type: Boolean,
      default: false
    },
    referralCreditedAt: {
      type: Date,
      default: null
    },
    referralAssignedAt: {
      type: Date,
      default: null
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'authorized', 'captured', 'failed'],
      default: 'pending'
    },
    paymentId: {
      type: String,
      default: null
    },
    paymentOrderId: {
      type: String,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    },
    confirmationSentAt: {
      type: Date,
      default: null
    },
    tier: {
      type: String,
      enum: ['starter', 'founding'],
      default: 'starter'
    },
    amount: {
      type: Number,
      default: 500,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

submissionSchema.index(
  { referralCode: 1 },
  {
    unique: true,
    partialFilterExpression: { referralCode: { $type: 'string' } }
  }
);

submissionSchema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { paymentId: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Submission', submissionSchema);
