const mongoose = require('mongoose');

const serviceRequestSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  serviceType: { type: String, required: true }, // 'tutoring', 'companionship', 'counseling', etc.
  title: { type: String, required: true },
  description: { type: String, required: true },
  
  // Service details
  duration: { type: Number }, // in hours
  scheduledDate: { type: Date },
  location: { type: String },
  isOnline: { type: Boolean, default: false },
  
  // Pricing
  agreedRate: { type: Number },
  totalAmount: { type: Number },
  adminCommission: { type: Number },
  
  // Status tracking
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'rejected', 'in-progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  
  // Communication
  chatRoom: { type: String }, // Socket.IO room ID
  
  // Payment
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  paymentId: { type: String },
  
  // Reviews
  clientReview: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String }
  },
  providerReview: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);