const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Get all service providers
router.get('/providers', async (req, res) => {
  try {
    const { serviceType, location } = req.query;
    
    let query = { role: 'provider', isActive: true };
    
    if (serviceType) {
      query.services = { $in: [serviceType] };
    }
    
    if (location) {
      query.location = new RegExp(location, 'i');
    }
    
    const providers = await User.find(query)
      .select('-password -paymentMethods')
      .sort({ rating: -1 });
    
    res.json(providers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get provider by ID
router.get('/providers/:id', async (req, res) => {
  try {
    const provider = await User.findById(req.params.id)
      .select('-password -paymentMethods');
    
    if (!provider || provider.role !== 'provider') {
      return res.status(404).json({ message: 'Provider not found' });
    }
    
    res.json(provider);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update provider profile
router.put('/profile', auth, async (req, res) => {
  try {
    const updates = req.body;
    delete updates.password; // Don't allow password updates here
    
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updates,
      { new: true }
    ).select('-password');
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;