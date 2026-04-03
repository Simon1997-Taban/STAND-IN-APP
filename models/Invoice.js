const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true },
  type: {
    type: String,
    enum: ['invoice', 'receipt', 'performance'],
    required: true
  },

  serviceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  transaction:    { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  client:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Service snapshot (so invoice stays accurate even if request changes)
  serviceTitle:   { type: String },
  serviceType:    { type: String },
  description:    { type: String },
  pricingType:    { type: String }, // hourly/daily/weekly/monthly/event
  duration:       { type: Number },
  durationUnit:   { type: String }, // hours/days/weeks/months
  scheduledDate:  { type: Date },
  location:       { type: String },

  // Amounts
  currency:       { type: String, default: 'USD' },
  agreedRate:     { type: Number },
  subtotal:       { type: Number },
  adminCommission:{ type: Number },
  providerAmount: { type: Number },
  totalAmount:    { type: Number },
  commissionRate: { type: Number, default: 10 },

  // Performance invoice extras
  performanceNotes: { type: String },
  tasksCompleted:   [{ type: String }],
  clientRating:     { type: Number },
  clientComment:    { type: String },

  // Status
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'cancelled'],
    default: 'draft'
  },
  paidAt:   { type: Date },
  issuedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Auto-generate invoice number before save
invoiceSchema.pre('save', function (next) {
  if (!this.invoiceNumber) {
    const prefix = this.type === 'receipt' ? 'RCP' : this.type === 'performance' ? 'PRF' : 'INV';
    this.invoiceNumber = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  next();
});

invoiceSchema.index({ client: 1, createdAt: -1 });
invoiceSchema.index({ provider: 1, createdAt: -1 });
invoiceSchema.index({ serviceRequest: 1 });
invoiceSchema.index({ type: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
