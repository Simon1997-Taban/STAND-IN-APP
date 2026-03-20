const express = require('express');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const auth = require('../middleware/auth');
const router = express.Router();

// Middleware to check admin role
const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Get dashboard stats
router.get('/dashboard', auth, adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalProviders = await User.countDocuments({ role: 'provider' });
    const totalClients = await User.countDocuments({ role: 'client' });
    const totalRequests = await ServiceRequest.countDocuments();
    const completedRequests = await ServiceRequest.countDocuments({ status: 'completed' });
    
    // Calculate total commission earned
    const completedRequestsWithCommission = await ServiceRequest.find({ 
      status: 'completed',
      paymentStatus: 'paid'
    });
    
    const totalCommission = completedRequestsWithCommission.reduce((sum, req) => sum + req.adminCommission, 0);
    
    res.json({
      totalUsers,
      totalProviders,
      totalClients,
      totalRequests,
      completedRequests,
      totalCommission
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all users
router.get('/users', auth, adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all service requests
router.get('/requests', auth, adminAuth, async (req, res) => {
  try {
    const requests = await ServiceRequest.find()
      .populate('client', 'name email')
      .populate('provider', 'name email')
      .sort({ createdAt: -1 });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Verify/unverify user
router.put('/users/:id/verify', auth, adminAuth, async (req, res) => {
  try {
    const { isVerified } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isVerified },
      { new: true }
    ).select('-password');
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Toggle user active status
router.put('/users/:id/status', auth, adminAuth, async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Analytics - revenue over time and popular services
router.get('/analytics', auth, adminAuth, async (req, res) => {
  try {
    const { Transaction } = require('../models/Payment');

    // Revenue by month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const revenueByMonth = await Transaction.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        revenue: { $sum: '$totalAmount' },
        commission: { $sum: '$adminCommission' },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // User growth by month
    const userGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, role: '$role' },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Popular services
    const popularServices = await ServiceRequest.aggregate([
      { $group: { _id: '$serviceType', count: { $sum: 1 }, totalRevenue: { $sum: '$totalAmount' } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]);

    res.json({ revenueByMonth, userGrowth, popularServices });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;