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

module.exports = router;