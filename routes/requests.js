const express = require('express');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Create service request
router.post('/', auth, async (req, res) => {
  try {
    const { providerId, serviceType, title, description, duration, scheduledDate, location, isOnline } = req.body;
    
    const provider = await User.findById(providerId);
    if (!provider || provider.role !== 'provider') {
      return res.status(404).json({ message: 'Provider not found' });
    }
    
    const totalAmount = provider.hourlyRate * duration;
    const adminCommission = totalAmount * 0.15; // 15% commission
    
    const request = new ServiceRequest({
      client: req.user.userId,
      provider: providerId,
      serviceType,
      title,
      description,
      duration,
      scheduledDate,
      location,
      isOnline,
      agreedRate: provider.hourlyRate,
      totalAmount,
      adminCommission,
      chatRoom: `${req.user.userId}_${providerId}_${Date.now()}`
    });
    
    await request.save();
    await request.populate(['client', 'provider']);
    
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's requests
router.get('/my-requests', auth, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.role === 'client') {
      query.client = req.user.userId;
    } else if (req.user.role === 'provider') {
      query.provider = req.user.userId;
    }
    
    const requests = await ServiceRequest.find(query)
      .populate('client', 'name email phone')
      .populate('provider', 'name email phone services rating')
      .sort({ createdAt: -1 });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update request status (accept/reject)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }
    
    // Only provider can accept/reject, only client can cancel
    if (req.user.role === 'provider' && request.provider.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
    if (req.user.role === 'client' && request.client.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
    request.status = status;
    await request.save();
    
    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;