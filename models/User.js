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
  bio: { type: String },
  
  // Provider specific fields
  services: [{ type: String }], // e.g., ['tutoring', 'companionship', 'counseling']
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
    type: { type: String }, // 'card', 'paypal', etc.
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

module.exports = mongoose.model('User', userSchema);