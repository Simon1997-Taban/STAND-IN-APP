const mongoose = require('mongoose');
const { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } = require('../utils/currency');

const supportedCurrencyCodes = SUPPORTED_CURRENCIES.map((currency) => currency.code);

const paymentMethodSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['bank_account', 'mobile_money', 'paypal', 'stripe'], 
    required: true 
  },
  currency: {
    type: String,
    enum: supportedCurrencyCodes,
    default: DEFAULT_CURRENCY
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

  // Cash details
  cashLabel: { type: String },
  
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
  baseCurrency: { type: String, default: DEFAULT_CURRENCY },
  currency: {
    type: String,
    enum: supportedCurrencyCodes,
    default: DEFAULT_CURRENCY
  },
  exchangeRate: { type: Number, default: 1 },
  baseTotalAmount: { type: Number, required: true },
  baseProviderAmount: { type: Number, required: true },
  baseAdminCommission: { type: Number, required: true },
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

  // Payment type determines confirmation flow
  paymentType: {
    type: String,
    enum: ['mobile_money', 'bank', 'wallet'],
    required: true
  },

  // Mobile money confirmation code (sent to client phone)
  mobileConfirmCode: { type: String },
  mobileConfirmExpires: { type: Date },
  mobileConfirmed: { type: Boolean, default: false },

  // Commission split tracking
  commissionSentToAdmin: { type: Boolean, default: false },
  providerAmountReleased: { type: Boolean, default: false },
  
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

// Indexes
paymentMethodSchema.index({ user: 1, isActive: 1 });
paymentMethodSchema.index({ user: 1, isDefault: 1 });
transactionSchema.index({ client: 1, createdAt: -1 });
transactionSchema.index({ provider: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ serviceRequest: 1 });

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { PaymentMethod, Transaction };
