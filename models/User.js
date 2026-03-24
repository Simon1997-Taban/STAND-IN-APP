const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, enum: ['client', 'provider', 'admin'], default: 'client' },
  profileImage: { type: String },
  age: { type: Number },
  location: { type: String },
  country: { type: String, default: 'UG' }, // ISO 3166-1 alpha-2
  preferredCurrency: { type: String, default: 'UGX' },
  bio: { type: String },

  // OTP verification
  otp: { type: String },
  otpExpires: { type: Date },
  emailVerified: { type: Boolean, default: false },

  // Provider specific fields
  services: [{ type: String }],
  hourlyRate: { type: Number },
  availability: [{
    day: String,
    startTime: String,
    endTime: String
  }],
  rating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },

  // Payment info
  paymentMethods: [{
    type: { type: String },
    details: { type: Object }
  }],

  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Indexes for high-traffic queries
userSchema.index({ role: 1 });
userSchema.index({ role: 1, isActive: 1, isVerified: 1 });

module.exports = mongoose.model('User', userSchema);