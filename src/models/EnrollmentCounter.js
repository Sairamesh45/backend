const mongoose = require('mongoose');

const enrollmentCounterSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true
    },
    totalPaid: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('EnrollmentCounter', enrollmentCounterSchema);