const express = require('express');
const { PaymentMethod, Transaction } = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  convertFromUsd,
  getExchangeRate,
  isSupportedCurrency,
  normalizeCurrency,
  roundMoney
} = require('../utils/currency');
const router = express.Router();

router.get('/currencies', auth, async (req, res) => {
  res.json(SUPPORTED_CURRENCIES);
});

// Add payment method
router.post('/methods', auth, async (req, res) => {
  try {
    const { type, bankName, accountNumber, accountName, routingNumber, swiftCode, 
            mobileProvider, mobileNumber, mobileAccountName, walletEmail, walletId, currency, cashLabel } = req.body;

    const selectedCurrency = isSupportedCurrency(currency)
      ? normalizeCurrency(currency)
      : DEFAULT_CURRENCY;

    if (type === 'cash' && !isSupportedCurrency(selectedCurrency)) {
      return res.status(400).json({ message: 'Select a valid cash payment currency' });
    }
    
    // If this is the first payment method, make it default
    const existingMethods = await PaymentMethod.countDocuments({ user: req.user.userId });
    const isDefault = existingMethods === 0;
    
    // If setting as default, remove default from other methods
    if (req.body.isDefault || isDefault) {
      await PaymentMethod.updateMany(
        { user: req.user.userId },
        { isDefault: false }
      );
    }
    
    const paymentMethod = new PaymentMethod({
      user: req.user.userId,
      type,
      bankName,
      accountNumber,
      accountName,
      routingNumber,
      swiftCode,
      mobileProvider,
      mobileNumber,
      mobileAccountName,
      walletEmail,
      walletId,
      currency: selectedCurrency,
      cashLabel,
      isDefault: req.body.isDefault || isDefault
    });
    
    await paymentMethod.save();
    res.status(201).json(paymentMethod);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's payment methods
router.get('/methods', auth, async (req, res) => {
  try {
    const paymentMethods = await PaymentMethod.find({ 
      user: req.user.userId, 
      isActive: true 
    }).sort({ isDefault: -1, createdAt: -1 });
    
    res.json(paymentMethods);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update payment method
router.put('/methods/:id', auth, async (req, res) => {
  try {
    const paymentMethod = await PaymentMethod.findOne({
      _id: req.params.id,
      user: req.user.userId
    });
    
    if (!paymentMethod) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    // If setting as default, remove default from other methods
    if (req.body.isDefault) {
      await PaymentMethod.updateMany(
        { user: req.user.userId, _id: { $ne: req.params.id } },
        { isDefault: false }
      );
    }

    if (req.body.currency && !isSupportedCurrency(req.body.currency)) {
      return res.status(400).json({ message: 'Invalid currency selection' });
    }
    
    Object.assign(paymentMethod, req.body);

    if (req.body.currency) {
      paymentMethod.currency = normalizeCurrency(req.body.currency);
    }

    await paymentMethod.save();
    
    res.json(paymentMethod);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete payment method
router.delete('/methods/:id', auth, async (req, res) => {
  try {
    const paymentMethod = await PaymentMethod.findOne({
      _id: req.params.id,
      user: req.user.userId
    });
    
    if (!paymentMethod) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    paymentMethod.isActive = false;
    await paymentMethod.save();
    
    res.json({ message: 'Payment method deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Process payment for service request
router.post('/process/:requestId', auth, async (req, res) => {
  try {
    const { clientPaymentMethodId, paymentCurrency } = req.body;
    
    const serviceRequest = await ServiceRequest.findById(req.params.requestId)
      .populate('client provider');
    
    if (!serviceRequest) {
      return res.status(404).json({ message: 'Service request not found' });
    }
    
    // Verify user is the client
    if (serviceRequest.client._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
    // Check if request is accepted
    if (serviceRequest.status !== 'accepted') {
      return res.status(400).json({ message: 'Service request must be accepted before payment' });
    }
    
    // Check if already paid or processing
    if (['processing', 'paid'].includes(serviceRequest.paymentStatus))
      return res.status(400).json({ message: 'Payment already initiated for this request' });

    // Get client payment method
    const clientPaymentMethod = await PaymentMethod.findOne({
      _id: clientPaymentMethodId,
      user: req.user.userId,
      isActive: true
    });
    
    if (!clientPaymentMethod) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    // Get provider's default payment method
    const providerPaymentMethod = await PaymentMethod.findOne({
      user: serviceRequest.provider._id,
      isDefault: true,
      isActive: true
    });
    
    if (!providerPaymentMethod) {
      return res.status(400).json({ message: 'Provider has not set up payment method' });
    }
    
    const baseTotalAmount = roundMoney(serviceRequest.baseTotalAmount || serviceRequest.totalAmount || 0);
    const baseAdminCommission = roundMoney(serviceRequest.baseAdminCommission || serviceRequest.adminCommission || (baseTotalAmount * 0.15));
    const baseProviderAmount = roundMoney(baseTotalAmount - baseAdminCommission);
    const selectedCurrency = isSupportedCurrency(paymentCurrency)
      ? normalizeCurrency(paymentCurrency)
      : normalizeCurrency(serviceRequest.paymentCurrency || clientPaymentMethod.currency || DEFAULT_CURRENCY);
    const exchangeRate = getExchangeRate(selectedCurrency);
    const totalAmount = convertFromUsd(baseTotalAmount, selectedCurrency);
    const adminCommission = convertFromUsd(baseAdminCommission, selectedCurrency);
    const providerAmount = convertFromUsd(baseProviderAmount, selectedCurrency);
    
    // Create transaction
    const transaction = new Transaction({
      serviceRequest: serviceRequest._id,
      client: serviceRequest.client._id,
      provider: serviceRequest.provider._id,
      baseCurrency: DEFAULT_CURRENCY,
      currency: selectedCurrency,
      exchangeRate,
      baseTotalAmount,
      baseProviderAmount,
      baseAdminCommission,
      totalAmount,
      providerAmount,
      adminCommission,
      clientPaymentMethod: clientPaymentMethod._id,
      providerPaymentMethod: providerPaymentMethod._id,
      paymentProcessor: 'manual', // For now, manual processing
      status: 'processing'
    });
    
    await transaction.save();
    
    // Update service request
    serviceRequest.baseCurrency = DEFAULT_CURRENCY;
    serviceRequest.paymentCurrency = selectedCurrency;
    serviceRequest.exchangeRate = exchangeRate;
    serviceRequest.baseTotalAmount = baseTotalAmount;
    serviceRequest.baseAdminCommission = baseAdminCommission;
    serviceRequest.totalAmount = totalAmount;
    serviceRequest.adminCommission = adminCommission;
    serviceRequest.paymentStatus = 'processing';
    serviceRequest.status = 'in-progress';
    await serviceRequest.save();
    
    res.json({
      message: 'Payment initiated successfully',
      transaction: transaction,
      breakdown: {
        currency: selectedCurrency,
        exchangeRate,
        totalAmount,
        providerAmount,
        adminCommission,
        commissionRate: '15%'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'client') {
      query.client = req.user.userId;
    } else if (req.user.role === 'provider') {
      query.provider = req.user.userId;
    } else if (req.user.role === 'admin') {
      // Admin can see all transactions
    } else {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
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

// Admin: Update transaction status
router.put('/transactions/:id/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { status, adminNotes } = req.body;
    
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    transaction.status = status;
    if (adminNotes) transaction.adminNotes = adminNotes;
    
    if (status === 'completed') {
      transaction.completedAt = new Date();
      
      // Update service request
      await ServiceRequest.findByIdAndUpdate(transaction.serviceRequest, {
        paymentStatus: 'paid',
        status: 'completed'
      });
    } else if (status === 'failed') {
      await ServiceRequest.findByIdAndUpdate(transaction.serviceRequest, {
        paymentStatus: 'failed',
        status: 'accepted' // revert back so client can retry
      });
    }
    
    await transaction.save();
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payment statistics (for admin)
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const totalTransactions = await Transaction.countDocuments();
    const completedTransactions = await Transaction.countDocuments({ status: 'completed' });
    const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
    
    const totalRevenue = await Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const totalCommission = await Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$adminCommission' } } }
    ]);
    
    res.json({
      totalTransactions,
      completedTransactions,
      pendingTransactions,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalCommission: totalCommission[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
