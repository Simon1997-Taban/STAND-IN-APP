const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['bank_account', 'mobile_money', 'paypal', 'stripe'], 
    required: true 
  },
  
  // Bank Account Details
  bankName: { type: String },
  accountNumber: { type: String },
  accountName: { type: String },
  routingNumber: { type: String },
  swiftCode: { type: String },
  
  // Mobile Money Details
  mobileProvider: { 
    type: String, 
    enum: ['mtn', 'airtel', 'vodafone', 'orange', 'mpesa', 'other'] 
  },
  mobileNumber: { type: String },
  mobileAccountName: { type: String },
  
  // Digital Wallet Details
  walletEmail: { type: String },
  walletId: { type: String },
  
  isDefault: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

const transactionSchema = new mongoose.Schema({
  serviceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Payment Details
  totalAmount: { type: Number, required: true },
  providerAmount: { type: Number, required: true }, // Amount after commission
  adminCommission: { type: Number, required: true }, // 15% commission
  
  // Payment Methods
  clientPaymentMethod: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' },
  providerPaymentMethod: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' },
  
  // Transaction Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'disputed'],
    default: 'pending'
  },
  
  // Payment Processing
  paymentProcessor: { type: String }, // 'manual', 'stripe', 'paypal', etc.
  externalTransactionId: { type: String },
  
  // Timestamps
  paidAt: { type: Date },
  processedAt: { type: Date },
  completedAt: { type: Date },
  
  // Notes and References
  clientNotes: { type: String },
  providerNotes: { type: String },
  adminNotes: { type: String },
  
  // Receipt Information
  receiptNumber: { type: String, unique: true },
  receiptUrl: { type: String }
}, {
  timestamps: true
});

// Generate receipt number before saving
transactionSchema.pre('save', function(next) {
  if (!this.receiptNumber) {
    this.receiptNumber = 'RCP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { PaymentMethod, Transaction };