const express = require('express');
const { Resend } = require('resend');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { PaymentMethod, Transaction } = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const {
  DEFAULT_CURRENCY, SUPPORTED_CURRENCIES,
  convertFromUsd, getExchangeRate,
  isSupportedCurrency, normalizeCurrency, roundMoney
} = require('../utils/currency');
const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const Invoice = require('../models/Invoice');

const COMMISSION_RATE = 0.10;

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many payment attempts. Please wait 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
}); // 10%

function generateConfirmCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendPaymentRequestEmail(clientEmail, clientName, providerName, amount, currency, requestTitle) {
  await resend.emails.send({
    from: 'Stand-In App <onboarding@resend.dev>',
    to: clientEmail,
    subject: 'Payment Request from ' + providerName,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#07111f;color:#ecf7ff;border-radius:16px;">
        <h2 style="color:#41e4de;">Payment Request</h2>
        <p style="color:#98abc6;">Hi ${clientName}, your service provider <strong style="color:#ecf7ff;">${providerName}</strong> has requested payment for <strong style="color:#ecf7ff;">${requestTitle}</strong>.</p>
        <div style="font-size:32px;font-weight:700;text-align:center;padding:20px;background:rgba(65,228,222,0.1);border-radius:12px;color:#41e4de;margin:20px 0;">${currency} ${amount}</div>
        <p style="color:#98abc6;">Log in to your Stand-In dashboard to review and confirm the payment using your PIN.</p>
      </div>
    `
  });
}

async function sendPaymentConfirmEmail(email, name, code, amount, currency) {
  await resend.emails.send({
    from: 'Stand-In App <onboarding@resend.dev>',
    to: email,
    subject: 'Confirm your Stand-In payment',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#07111f;color:#ecf7ff;border-radius:16px;">
        <h2 style="color:#41e4de;">Payment Confirmation</h2>
        <p style="color:#98abc6;">Hi ${name}, you initiated a payment of <strong style="color:#ecf7ff;">${currency} ${amount}</strong> via mobile money.</p>
        <p style="color:#98abc6;margin-bottom:24px;">Enter this code in the app to confirm:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:20px;background:rgba(65,228,222,0.1);border-radius:12px;color:#41e4de;">${code}</div>
        <p style="color:#98abc6;margin-top:24px;font-size:13px;">This code expires in 10 minutes.</p>
      </div>
    `
  });
}

async function finalizePayment(transaction, serviceRequest) {
  transaction.status = 'completed';
  transaction.completedAt = new Date();
  transaction.commissionSentToAdmin = true;
  transaction.providerAmountReleased = true;
  await transaction.save();

  serviceRequest.paymentStatus = 'paid';
  serviceRequest.status = 'completed';
  await serviceRequest.save();
}

// Get currencies
router.get('/currencies', auth, (req, res) => {
  res.json(SUPPORTED_CURRENCIES);
});

// Add payment method (no cash)
router.post('/methods', auth, async (req, res) => {
  try {
    const {
      type, bankName, accountNumber, accountName, routingNumber, swiftCode,
      mobileProvider, mobileNumber, mobileAccountName, walletEmail, walletId, currency
    } = req.body;

    if (type === 'cash')
      return res.status(400).json({ message: 'Cash payments are not accepted. Please use bank, mobile money, or digital wallet.' });

    const selectedCurrency = isSupportedCurrency(currency) ? normalizeCurrency(currency) : DEFAULT_CURRENCY;
    const existingCount = await PaymentMethod.countDocuments({ user: req.user.userId });
    const isDefault = existingCount === 0;

    if (req.body.isDefault || isDefault) {
      await PaymentMethod.updateMany({ user: req.user.userId }, { isDefault: false });
    }

    const paymentMethod = new PaymentMethod({
      user: req.user.userId, type, bankName, accountNumber, accountName,
      routingNumber, swiftCode, mobileProvider, mobileNumber, mobileAccountName,
      walletEmail, walletId, currency: selectedCurrency,
      isDefault: req.body.isDefault || isDefault
    });

    await paymentMethod.save();
    res.status(201).json(paymentMethod);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payment methods
router.get('/methods', auth, async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ user: req.user.userId, isActive: true })
      .sort({ isDefault: -1, createdAt: -1 });
    res.json(methods);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update payment method
router.put('/methods/:id', auth, async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({ _id: req.params.id, user: req.user.userId });
    if (!method) return res.status(404).json({ message: 'Payment method not found' });

    // Explicit whitelist — no mass assignment
    const allowed = ['bankName','accountNumber','accountName','routingNumber','swiftCode',
      'mobileProvider','mobileNumber','mobileAccountName','walletEmail','walletId','isDefault'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) method[key] = req.body[key];
    }
    if (req.body.currency) method.currency = normalizeCurrency(req.body.currency);

    if (req.body.isDefault) {
      await PaymentMethod.updateMany({ user: req.user.userId, _id: { $ne: req.params.id } }, { isDefault: false });
    }

    await method.save();
    res.json(method);
  } catch (error) {
    res.status(500).json({ message: 'Update failed. Please try again.' });
  }
});

// Delete payment method
router.delete('/methods/:id', auth, async (req, res) => {
  try {
    const method = await PaymentMethod.findOne({ _id: req.params.id, user: req.user.userId });
    if (!method) return res.status(404).json({ message: 'Payment method not found' });
    method.isActive = false;
    await method.save();
    res.json({ message: 'Payment method removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Set or update payment PIN (client only)
router.post('/set-pin', auth, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ message: 'Only clients can set a payment PIN' });
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'PIN must be exactly 4 digits' });
    const user = await User.findById(req.user.userId);
    user.paymentPin = await bcrypt.hash(pin, 10);
    await user.save();
    res.json({ message: 'Payment PIN set successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Could not set PIN. Please try again.' });
  }
});

// Provider requests payment from client
router.post('/request/:requestId', auth, paymentLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'provider') return res.status(403).json({ message: 'Only providers can request payment' });

    const serviceRequest = await ServiceRequest.findById(req.params.requestId).populate('client provider');
    if (!serviceRequest) return res.status(404).json({ message: 'Service request not found' });
    if (serviceRequest.provider._id.toString() !== req.user.userId) return res.status(403).json({ message: 'Unauthorized' });
    if (!['accepted', 'in-progress', 'completed'].includes(serviceRequest.status))
      return res.status(400).json({ message: 'Service must be accepted or completed before requesting payment' });
    if (['processing', 'paid'].includes(serviceRequest.paymentStatus))
      return res.status(400).json({ message: 'Payment already requested or completed' });

    const selectedCurrency = normalizeCurrency(serviceRequest.paymentCurrency || DEFAULT_CURRENCY);
    const totalAmount = serviceRequest.totalAmount || 0;

    // Create pending transaction initiated by provider
    const transaction = new Transaction({
      serviceRequest: serviceRequest._id,
      client: serviceRequest.client._id,
      provider: serviceRequest.provider._id,
      baseCurrency: DEFAULT_CURRENCY,
      currency: selectedCurrency,
      exchangeRate: serviceRequest.exchangeRate || 1,
      baseTotalAmount: serviceRequest.baseTotalAmount || totalAmount,
      baseProviderAmount: roundMoney((serviceRequest.baseTotalAmount || totalAmount) * (1 - COMMISSION_RATE)),
      baseAdminCommission: roundMoney((serviceRequest.baseTotalAmount || totalAmount) * COMMISSION_RATE),
      totalAmount,
      providerAmount: roundMoney(totalAmount * (1 - COMMISSION_RATE)),
      adminCommission: roundMoney(totalAmount * COMMISSION_RATE),
      paymentType: 'mobile_money',
      status: 'pending',
      initiatedBy: req.user.userId,
      paymentRequestedAt: new Date(),
      clientAlerted: false
    });
    await transaction.save();

    serviceRequest.paymentStatus = 'processing';
    await serviceRequest.save();

    // Alert client via email in background
    sendPaymentRequestEmail(
      serviceRequest.client.email,
      serviceRequest.client.name,
      serviceRequest.provider.name,
      totalAmount,
      selectedCurrency,
      serviceRequest.title
    ).then(async () => {
      transaction.clientAlerted = true;
      await transaction.save();
    }).catch(err => console.error('Payment request email error:', err.message));

    // Also notify via Socket.IO if client is online
    const io = req.app.get('io');
    if (io) {
      io.to(serviceRequest.client._id.toString()).emit('payment-requested', {
        transactionId: transaction._id,
        providerName: serviceRequest.provider.name,
        amount: totalAmount,
        currency: selectedCurrency,
        title: serviceRequest.title
      });
    }

    res.json({
      message: 'Payment request sent to client successfully.',
      transactionId: transaction._id,
      breakdown: { currency: selectedCurrency, totalAmount, providerAmount: transaction.providerAmount, adminCommission: transaction.adminCommission, commissionRate: '10%' }
    });

    // Auto-generate invoice in background
    Invoice.findOne({ serviceRequest: serviceRequest._id, type: 'invoice' }).then(existing => {
      if (!existing) {
        const pricingType = serviceRequest.pricingType || 'hourly';
        const durationUnitMap = { hourly:'hours', daily:'days', weekly:'weeks', monthly:'months', event:'event(s)' };
        return new Invoice({
          type: 'invoice',
          serviceRequest: serviceRequest._id,
          transaction: transaction._id,
          client: serviceRequest.client._id,
          provider: serviceRequest.provider._id,
          serviceTitle: serviceRequest.title,
          serviceType: serviceRequest.serviceType,
          description: serviceRequest.description,
          pricingType,
          duration: serviceRequest.duration,
          durationUnit: durationUnitMap[pricingType] || 'hours',
          scheduledDate: serviceRequest.scheduledDate,
          location: serviceRequest.location,
          currency: selectedCurrency,
          agreedRate: serviceRequest.agreedRate || 0,
          subtotal: totalAmount,
          adminCommission: transaction.adminCommission,
          providerAmount: transaction.providerAmount,
          totalAmount,
          commissionRate: 10,
          status: 'sent'
        }).save();
      }
    }).catch(err => console.error('Invoice generation error:', err.message));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Client confirms payment with PIN
router.post('/confirm-pin/:transactionId', auth, paymentLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ message: 'Only clients can confirm payment' });
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ message: 'PIN is required' });

    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    if (transaction.client.toString() !== req.user.userId) return res.status(403).json({ message: 'Unauthorized' });
    if (transaction.status === 'completed') return res.status(400).json({ message: 'Payment already completed' });

    const client = await User.findById(req.user.userId);
    if (!client.paymentPin) return res.status(400).json({ message: 'You have not set a payment PIN yet. Please set one in payment settings.' });

    const pinValid = await bcrypt.compare(pin, client.paymentPin);
    if (!pinValid) return res.status(400).json({ message: 'Incorrect PIN. Please try again.' });

    const serviceRequest = await ServiceRequest.findById(transaction.serviceRequest);
    await finalizePayment(transaction, serviceRequest);

    // Auto-generate receipt in background
    Invoice.findOne({ serviceRequest: serviceRequest._id, type: 'receipt' }).then(existing => {
      if (!existing) {
        const durationUnitMap = { hourly:'hours', daily:'days', weekly:'weeks', monthly:'months', event:'event(s)' };
        const pt = serviceRequest.pricingType || 'hourly';
        return new Invoice({
          type: 'receipt',
          serviceRequest: serviceRequest._id,
          transaction: transaction._id,
          client: transaction.client,
          provider: transaction.provider,
          serviceTitle: serviceRequest.title,
          serviceType: serviceRequest.serviceType,
          pricingType: pt,
          duration: serviceRequest.duration,
          durationUnit: durationUnitMap[pt] || 'hours',
          currency: transaction.currency,
          agreedRate: serviceRequest.agreedRate || 0,
          subtotal: transaction.totalAmount,
          adminCommission: transaction.adminCommission,
          providerAmount: transaction.providerAmount,
          totalAmount: transaction.totalAmount,
          commissionRate: 10,
          status: 'paid',
          paidAt: new Date()
        }).save();
      }
    }).catch(err => console.error('Receipt generation error:', err.message));

    res.json({
      message: 'Payment confirmed successfully!',
      breakdown: {
        currency: transaction.currency,
        totalAmount: transaction.totalAmount,
        providerReceives: transaction.providerAmount,
        adminCommission: transaction.adminCommission,
        commissionRate: '10%'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Initiate payment — auto-deducts for bank/wallet, sends confirm code for mobile money
router.post('/process/:requestId', auth, paymentLimiter, async (req, res) => {
  try {
    const { clientPaymentMethodId, paymentCurrency } = req.body;

    const serviceRequest = await ServiceRequest.findById(req.params.requestId).populate('client provider');
    if (!serviceRequest) return res.status(404).json({ message: 'Service request not found' });

    if (serviceRequest.client._id.toString() !== req.user.userId)
      return res.status(403).json({ message: 'Unauthorized' });

    if (serviceRequest.status !== 'accepted')
      return res.status(400).json({ message: 'Service request must be accepted before payment' });

    if (['processing', 'paid'].includes(serviceRequest.paymentStatus))
      return res.status(400).json({ message: 'Payment already initiated for this request' });

    const clientMethod = await PaymentMethod.findOne({ _id: clientPaymentMethodId, user: req.user.userId, isActive: true });
    if (!clientMethod) return res.status(404).json({ message: 'Payment method not found' });

    const providerMethod = await PaymentMethod.findOne({ user: serviceRequest.provider._id, isDefault: true, isActive: true });
    if (!providerMethod) return res.status(400).json({ message: 'Provider has not set up a payment method yet' });

    const selectedCurrency = isSupportedCurrency(paymentCurrency)
      ? normalizeCurrency(paymentCurrency)
      : normalizeCurrency(serviceRequest.paymentCurrency || clientMethod.currency || DEFAULT_CURRENCY);

    const exchangeRate = getExchangeRate(selectedCurrency);
    const baseTotalAmount = roundMoney(serviceRequest.baseTotalAmount || serviceRequest.totalAmount || 0);
    const baseAdminCommission = roundMoney(baseTotalAmount * COMMISSION_RATE);
    const baseProviderAmount = roundMoney(baseTotalAmount - baseAdminCommission);
    const totalAmount = convertFromUsd(baseTotalAmount, selectedCurrency);
    const adminCommission = convertFromUsd(baseAdminCommission, selectedCurrency);
    const providerAmount = convertFromUsd(baseProviderAmount, selectedCurrency);

    const isMobile = clientMethod.type === 'mobile_money';
    const paymentType = isMobile ? 'mobile_money' : (clientMethod.type === 'bank_account' ? 'bank' : 'wallet');

    const transaction = new Transaction({
      serviceRequest: serviceRequest._id,
      client: serviceRequest.client._id,
      provider: serviceRequest.provider._id,
      baseCurrency: DEFAULT_CURRENCY,
      currency: selectedCurrency,
      exchangeRate,
      baseTotalAmount, baseProviderAmount, baseAdminCommission,
      totalAmount, providerAmount, adminCommission,
      clientPaymentMethod: clientMethod._id,
      providerPaymentMethod: providerMethod._id,
      paymentProcessor: paymentType,
      paymentType,
      status: 'processing'
    });

    if (isMobile) {
      // Send confirmation code to client email (simulating SMS)
      const code = generateConfirmCode();
      transaction.mobileConfirmCode = code;
      transaction.mobileConfirmExpires = new Date(Date.now() + 10 * 60 * 1000);
      transaction.mobileConfirmed = false;
      await transaction.save();

      serviceRequest.paymentStatus = 'processing';
      await serviceRequest.save();

      try {
        await sendPaymentConfirmEmail(
          serviceRequest.client.email,
          serviceRequest.client.name,
          code,
          totalAmount,
          selectedCurrency
        );
      } catch (e) {
        console.error('Payment confirm email error:', e.message);
      }

      return res.json({
        message: 'A confirmation code has been sent to your email. Enter it to complete the payment.',
        transactionId: transaction._id,
        requiresConfirmation: true,
        breakdown: { currency: selectedCurrency, totalAmount, providerAmount, adminCommission, commissionRate: '10%' }
      });
    }

    // Bank / wallet — instant deduction, no confirmation needed
    await transaction.save();
    await finalizePayment(transaction, serviceRequest);

    res.json({
      message: 'Payment successful. The provider will receive their amount after the 10% platform commission.',
      transactionId: transaction._id,
      requiresConfirmation: false,
      breakdown: { currency: selectedCurrency, totalAmount, providerAmount, adminCommission, commissionRate: '10%' }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Confirm mobile money payment with code
router.post('/confirm/:transactionId', auth, paymentLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Confirmation code is required' });

    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    if (transaction.client.toString() !== req.user.userId)
      return res.status(403).json({ message: 'Unauthorized' });

    if (transaction.mobileConfirmed)
      return res.status(400).json({ message: 'Payment already confirmed' });

    if (transaction.mobileConfirmCode !== code.trim())
      return res.status(400).json({ message: 'Incorrect confirmation code' });

    if (transaction.mobileConfirmExpires < new Date())
      return res.status(400).json({ message: 'Confirmation code has expired. Please initiate payment again.' });

    transaction.mobileConfirmed = true;
    const serviceRequest = await ServiceRequest.findById(transaction.serviceRequest);
    await finalizePayment(transaction, serviceRequest);

    res.json({
      message: 'Payment confirmed! Commission has been directed to the admin. The provider will receive their net amount.',
      breakdown: {
        currency: transaction.currency,
        totalAmount: transaction.totalAmount,
        providerReceives: transaction.providerAmount,
        adminCommission: transaction.adminCommission,
        commissionRate: '10%'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Resend mobile confirmation code
router.post('/resend-confirm/:transactionId', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId).populate('client');
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    if (transaction.client._id.toString() !== req.user.userId) return res.status(403).json({ message: 'Unauthorized' });
    if (transaction.mobileConfirmed) return res.status(400).json({ message: 'Already confirmed' });

    const code = generateConfirmCode();
    transaction.mobileConfirmCode = code;
    transaction.mobileConfirmExpires = new Date(Date.now() + 10 * 60 * 1000);
    await transaction.save();

    await sendPaymentConfirmEmail(
      transaction.client.email,
      transaction.client.name,
      code,
      transaction.totalAmount,
      transaction.currency
    );

    res.json({ message: 'A new confirmation code has been sent to your email.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'client') query.client = req.user.userId;
    else if (req.user.role === 'provider') query.provider = req.user.userId;
    else if (req.user.role !== 'admin') return res.status(403).json({ message: 'Unauthorized' });

    const transactions = await Transaction.find(query)
      .populate('serviceRequest', 'title serviceType')
      .populate('client', 'name email')
      .populate('provider', 'name email')
      .populate('clientPaymentMethod')
      .populate('providerPaymentMethod')
      .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Payment stats (admin)
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

    const [totalTransactions, completedTransactions, pendingTransactions, revenueAgg, commissionAgg] = await Promise.all([
      Transaction.countDocuments(),
      Transaction.countDocuments({ status: 'completed' }),
      Transaction.countDocuments({ status: 'processing' }),
      Transaction.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Transaction.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$adminCommission' } } }])
    ]);

    res.json({
      totalTransactions, completedTransactions, pendingTransactions,
      totalRevenue: revenueAgg[0]?.total || 0,
      totalCommission: commissionAgg[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
