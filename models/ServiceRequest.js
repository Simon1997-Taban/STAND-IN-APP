const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  userRole: { type: String, enum: ['client', 'provider', 'admin'], required: true },
  userImage: { type: String },
  message: { type: String, required: true, trim: true, maxlength: 1500 },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const eventPostSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  authorRole: { type: String, enum: ['client', 'provider', 'admin'], required: true },
  authorImage: { type: String },
  caption: { type: String, trim: true, maxlength: 800 },
  photos: {
    type: [{ type: String }],
    validate: {
      validator: function (photos) {
        return !photos || photos.length <= 6;
      },
      message: 'A maximum of 6 event photos is allowed per post'
    }
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

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
  baseCurrency: { type: String, default: 'USD' },
  paymentCurrency: { type: String, default: 'USD' },
  exchangeRate: { type: Number, default: 1 },
  baseAgreedRate: { type: Number },
  baseTotalAmount: { type: Number },
  baseAdminCommission: { type: Number },
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
  chatMessages: [chatMessageSchema],
  
  // Zoom link for online services
  zoomLink: { type: String },
  clientLocation: { type: String },

  // Payment
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'refunded'],
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
  },

  // Shared media timeline
  eventPosts: [eventPostSchema]
}, {
  timestamps: true
});

// Indexes for high-traffic queries
serviceRequestSchema.index({ client: 1, createdAt: -1 });
serviceRequestSchema.index({ provider: 1, createdAt: -1 });
serviceRequestSchema.index({ status: 1 });
serviceRequestSchema.index({ chatRoom: 1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
