const express = require('express');
const { PaymentMethod, Transaction } = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Add payment method
router.post('/methods', auth, async (req, res) => {
  try {
    const { type, bankName, accountNumber, accountName, routingNumber, swiftCode, 
            mobileProvider, mobileNumber, mobileAccountName, walletEmail, walletId } = req.body;
    
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
    
    Object.assign(paymentMethod, req.body);
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
    const { clientPaymentMethodId } = req.body;
    
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
    
    // Calculate amounts (15% commission)
    const totalAmount = serviceRequest.totalAmount;
    const adminCommission = totalAmount * 0.15;
    const providerAmount = totalAmount - adminCommission;
    
    // Create transaction
    const transaction = new Transaction({
      serviceRequest: serviceRequest._id,
      client: serviceRequest.client._id,
      provider: serviceRequest.provider._id,
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
    serviceRequest.paymentStatus = 'processing';
    serviceRequest.status = 'in-progress';
    await serviceRequest.save();
    
    res.json({
      message: 'Payment initiated successfully',
      transaction: transaction,
      breakdown: {
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
      // Update service request
      await ServiceRequest.findByIdAndUpdate(transaction.serviceRequest, {
        paymentStatus: 'failed'
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